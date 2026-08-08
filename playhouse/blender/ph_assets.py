"""Procedural asset library for the Blender/Cycles render path.

Everything here is built from maths: there are no textures, no HDRIs and no
downloaded meshes, because the render box has no network. That constraint is
also an opportunity — a procedural asset can be seeded, so twenty-seven trees
in one forest are twenty-seven *different* trees rather than twenty-seven
copies, which is the single cheapest way to stop a frame reading as CG.

DESIGN RULES, all of them learned from rendered A/B tests (see the film-look
research summarised in ``apply_film_look``):

* Nothing is flat-shaded and nothing has a razor edge. A perfectly sharp
  convex edge produces a zero-width specular highlight, which the eye reads as
  "computer" instantly. Every builder ends in :func:`_finish`, which adds a
  geometric Bevel modifier and smooth-by-angle shading.
* No material has a constant roughness. Uniform roughness is what makes
  injection-moulded plastic look like injection-moulded plastic.
* No albedo is pure black or pure white. Pure black clothing renders as a
  shapeless hole; pure white blows out under any exposure that keeps the sky.
  Every colour is squeezed into ``[0.03, 0.85]`` linear.
* Silhouette beats surface. A tree is judged at EWS by its outline, so the
  trunks lean, the canopies are lumpy layered masses rather than one sphere,
  and every instance is a different shape.

CONVENTIONS (the contract with ``render_scene.py``):

* Blender is Z-up. Assets are authored Z-up, in metres.
* Every builder returns one object whose **origin sits at its base** — the
  ground-contact point for things that stand on the ground, the lowest point
  of the model for things that hover or are carried. So the translator can
  write ``obj.location = (x, y, z)`` and be done.
* Every asset **faces +Y**. The scene file is Y-up and its own facing
  convention; the translator does the axis swap, not this module.

Public API:

    make_ground(size_x, size_y, kind) -> object
    make_tree(seed=0, scale=1.0) -> object
    make_drone(scale=1.0) -> object
    make_rifle(scale=1.0) -> object
    make_character(spec, name) -> object          (an armature object)
    pose_character(obj, pose)
    set_world(mood, fog)      -> {'world', 'sun', 'kick', 'fog'}
    apply_film_look(scene)

Supporting entry points the translator needs, because lighting in this recipe
is PER SHOT rather than per scene — both directional lights are placed
relative to the camera's heading, so a camera move that changes heading must
re-aim them or the shot loses its backlight:

    aim_key_light(sun, heading_deg)     165 degrees off camera: backlit
    aim_kick_light(kick, heading_deg)   28 degrees the other way: cool fill
    link_kick(kick, cast_objects)       restrict the fill to the cast
    add_fog(scene, density=..., size=..., centre=...)
    principled(name, base, ...)         the house material, for extra props
    hex_rgb / clamp_albedo / kelvin_rgb
"""

import colorsys
import math

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

TAU = math.pi * 2.0

# ---------------------------------------------------------------------------
# Determinism
# ---------------------------------------------------------------------------


class Rng:
    """A tiny xorshift PRNG.

    Python's ``random`` is fine, but a *seeded, self-contained* generator means
    ``make_tree(seed=7)`` produces the same tree in every process, in every
    order, no matter what else has drawn random numbers. Reproducible frames
    matter more here than statistical quality.
    """

    def __init__(self, seed=1):
        self.s = (int(seed) * 2654435761 + 1013904223) & 0xFFFFFFFF or 1

    def next(self):
        s = self.s
        s ^= (s << 13) & 0xFFFFFFFF
        s ^= s >> 17
        s ^= (s << 5) & 0xFFFFFFFF
        self.s = s & 0xFFFFFFFF
        return self.s / 4294967296.0

    def range(self, lo, hi):
        return lo + (hi - lo) * self.next()

    def pick(self, items):
        return items[int(self.next() * len(items)) % len(items)]

    def sign(self):
        return 1.0 if self.next() > 0.5 else -1.0


def _hash3(i, j, k, seed):
    """Integer hash -> [0, 1). Used for the value noise below."""
    h = (i * 374761393 + j * 668265263 + k * 2147483647 + seed * 362437) & 0xFFFFFFFF
    h = (h ^ (h >> 13)) * 1274126177 & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFFFFFF) / 4294967296.0


def _vnoise(p, seed=0):
    """Trilinear value noise in [0, 1].

    Cheap and smooth enough to break up a silhouette. Used to deform canopy
    masses and the ground plane; the shader-level noise textures do the
    fine-grain work, this only shapes geometry.
    """
    x, y, z = p
    i, j, k = math.floor(x), math.floor(y), math.floor(z)
    fx, fy, fz = x - i, y - j, z - k
    # Smoothstep the fractional part, otherwise the lattice shows as creases.
    ux = fx * fx * (3 - 2 * fx)
    uy = fy * fy * (3 - 2 * fy)
    uz = fz * fz * (3 - 2 * fz)
    c = [[[_hash3(i + a, j + b, k + c_, seed) for c_ in (0, 1)] for b in (0, 1)]
         for a in (0, 1)]

    def lerp(a, b, t):
        return a + (b - a) * t

    x00 = lerp(c[0][0][0], c[1][0][0], ux)
    x10 = lerp(c[0][1][0], c[1][1][0], ux)
    x01 = lerp(c[0][0][1], c[1][0][1], ux)
    x11 = lerp(c[0][1][1], c[1][1][1], ux)
    return lerp(lerp(x00, x10, uy), lerp(x01, x11, uy), uz)


def _fbm(p, seed=0, octaves=3, lac=2.1, gain=0.5):
    """Fractal sum of value noise, normalised to roughly [0, 1]."""
    total, amp, norm = 0.0, 1.0, 0.0
    v = Vector(p)
    for o in range(octaves):
        total += amp * _vnoise(v * (lac ** o), seed + o * 17)
        norm += amp
        amp *= gain
    return total / norm


# ---------------------------------------------------------------------------
# Colour
# ---------------------------------------------------------------------------

# In sRGB-encoded units, because that is the space in which "not a hole" and
# "not blown out" actually mean something. See clamp_albedo.
ALBEDO_MIN, ALBEDO_MAX = 0.14, 0.95


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgb(value, default=(0.5, 0.5, 0.5)):
    """'#3c4a3a' (or a 3-tuple) -> linear RGB."""
    if value is None:
        return default
    if isinstance(value, (tuple, list)):
        return tuple(float(c) for c in value[:3])
    s = str(value).lstrip('#')
    if len(s) == 3:
        s = ''.join(ch * 2 for ch in s)
    if len(s) != 6:
        return default
    try:
        srgb = [int(s[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    except ValueError:
        return default
    return tuple(srgb_to_linear(c) for c in srgb)


def linear_to_srgb(c):
    return c * 12.92 if c <= 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055


def clamp_albedo(rgb):
    """Squeeze a linear colour into the printable range.

    Measured: a pure-black coat renders as a silhouette-less hole because
    nothing in a dusk scene is bright enough to reveal its form, and a pure
    white blows out under any exposure that keeps the sky.

    Two details that a naive implementation gets wrong, both found by
    rendering the naive version first:

    * It works in *perceptual* (sRGB-encoded) space. A floor of 0.03 applied
      to a linear value is a floor of 0.19 perceptually, which drags every
      dark colour in the scene up to the same washed-out grey; a forest
      without darks has no depth left.
    * It is a clamp on the *brightest channel*, and the other two are scaled
      with it. Clamping each channel independently pulls the dark channels up
      faster than the bright one, so it desaturates as it lifts — a dark brown
      bark came out a pale pink-grey, which is exactly the CG palette the
      whole exercise is trying to avoid. Scaling preserves hue and saturation
      exactly and only moves value.
    """
    c = [min(max(v, 0.0), 1.0) for v in rgb]
    peak = max(c)
    if peak <= 0.0:
        floor = srgb_to_linear(ALBEDO_MIN)
        return (floor, floor, floor)
    s = linear_to_srgb(peak)
    target = srgb_to_linear(min(max(s, ALBEDO_MIN), ALBEDO_MAX))
    k = target / peak
    return tuple(v * k for v in c)


def jitter_colour(rgb, rng, hue=0.02, sat=0.12, val=0.18):
    """Nudge a colour in HSV space so seeded instances differ.

    Hue moves least: a forest where every tree is a different hue reads as a
    fruit bowl. Value moves most, because value variation is what makes a
    stand of trees look like depth rather than a wall.
    """
    h, s, v = colorsys.rgb_to_hsv(*[min(max(c, 0.0), 1.0) for c in rgb])
    h = (h + rng.range(-hue, hue)) % 1.0
    s = min(1.0, max(0.0, s * rng.range(1.0 - sat, 1.0 + sat)))
    v = min(1.0, max(0.0, v * rng.range(1.0 - val, 1.0 + val)))
    return colorsys.hsv_to_rgb(h, s, v)


def kelvin_rgb(k):
    """Blackbody colour, luminance-normalised.

    Normalising means changing a light's colour temperature does not silently
    change the exposure, so the mood table below can be tuned one axis at a
    time.
    """
    t = k / 100.0
    if t <= 66:
        r, g = 255.0, 99.4708025861 * math.log(max(t, 1.0)) - 161.1195681661
    else:
        r = 329.698727446 * ((t - 60) ** -0.1332047592)
        g = 288.1221695283 * ((t - 60) ** -0.0755148492)
    b = (255.0 if t >= 66 else
         0.0 if t <= 19 else
         138.5177312231 * math.log(t - 10) - 305.0447927307)
    rgb = [max(0.0, min(255.0, v)) / 255.0 for v in (r, g, b)]
    lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
    return [v / max(lum, 1e-4) for v in rgb]


# ---------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------


def principled(name, base, rough=0.7, metal=0.0, sheen=0.0, rough_var=0.14,
               noise_scale=14.0, subsurface=0.0, sss_radius=(0.4, 0.16, 0.10),
               bump=0.0, bump_scale=30.0, clamp=True):
    """A Principled BSDF whose roughness is driven by a noise texture.

    Constant roughness is the loudest remaining CG tell once the lighting is
    right: it produces an identical highlight shape everywhere on a surface,
    which no real object has. Two lines of noise fixes it and costs nothing.

    ``bump`` adds a second noise as a normal perturbation — used for bark,
    ground and cloth, where the *geometry* is smooth but the surface should
    not be.
    """
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    col = clamp_albedo(base) if clamp else tuple(base)
    bsdf.inputs['Base Color'].default_value = (*col, 1.0)
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Roughness'].default_value = rough
    if sheen:
        bsdf.inputs['Sheen Weight'].default_value = sheen
        bsdf.inputs['Sheen Roughness'].default_value = 0.4
    if subsurface:
        bsdf.inputs['Subsurface Weight'].default_value = subsurface
        bsdf.inputs['Subsurface Radius'].default_value = sss_radius
        bsdf.inputs['Subsurface Scale'].default_value = 0.06

    if rough_var > 0:
        tex = nt.nodes.new('ShaderNodeTexNoise')
        tex.inputs['Scale'].default_value = noise_scale
        tex.inputs['Detail'].default_value = 6.0
        tex.inputs['Roughness'].default_value = 0.55
        mr = nt.nodes.new('ShaderNodeMapRange')
        mr.inputs['To Min'].default_value = max(0.04, rough - rough_var)
        mr.inputs['To Max'].default_value = min(1.0, rough + rough_var)
        nt.links.new(tex.outputs['Fac'], mr.inputs['Value'])
        nt.links.new(mr.outputs['Result'], bsdf.inputs['Roughness'])

    if bump > 0:
        btex = nt.nodes.new('ShaderNodeTexNoise')
        btex.inputs['Scale'].default_value = bump_scale
        btex.inputs['Detail'].default_value = 8.0
        bnode = nt.nodes.new('ShaderNodeBump')
        bnode.inputs['Strength'].default_value = bump
        bnode.inputs['Distance'].default_value = 0.02
        nt.links.new(btex.outputs['Fac'], bnode.inputs['Height'])
        nt.links.new(bnode.outputs['Normal'], bsdf.inputs['Normal'])
    return mat


def _mix_colour_material(name, col_a, col_b, scale, rough, bump=0.0,
                         bump_scale=40.0, sheen=0.0, texture='NOISE',
                         detail=8.0, distortion=0.0):
    """Two-tone material: the second colour blotches through the first.

    A single flat albedo on a 44 x 44 m ground plane is a dead giveaway even
    under fog. Blotching a second, darker tone through it at a large scale
    gives the eye something to measure distance against.
    """
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Metallic'].default_value = 0.0
    if sheen:
        bsdf.inputs['Sheen Weight'].default_value = sheen

    if texture == 'VORONOI':
        tex = nt.nodes.new('ShaderNodeTexVoronoi')
        tex.feature = 'DISTANCE_TO_EDGE'
        tex.inputs['Scale'].default_value = scale
        fac = tex.outputs['Distance']
    elif texture == 'WAVE':
        tex = nt.nodes.new('ShaderNodeTexWave')
        tex.wave_type = 'BANDS'
        tex.bands_direction = 'X'
        tex.inputs['Scale'].default_value = scale
        tex.inputs['Distortion'].default_value = distortion
        tex.inputs['Detail'].default_value = detail
        fac = tex.outputs['Fac']
    else:
        tex = nt.nodes.new('ShaderNodeTexNoise')
        tex.inputs['Scale'].default_value = scale
        tex.inputs['Detail'].default_value = detail
        tex.inputs['Distortion'].default_value = distortion
        fac = tex.outputs['Fac']

    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.34
    ramp.color_ramp.elements[1].position = 0.66
    ramp.color_ramp.elements[0].color = (*clamp_albedo(col_a), 1.0)
    ramp.color_ramp.elements[1].color = (*clamp_albedo(col_b), 1.0)
    nt.links.new(fac, ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])

    rmr = nt.nodes.new('ShaderNodeMapRange')
    rmr.inputs['To Min'].default_value = max(0.05, rough - 0.16)
    rmr.inputs['To Max'].default_value = min(1.0, rough + 0.16)
    nt.links.new(fac, rmr.inputs['Value'])
    nt.links.new(rmr.outputs['Result'], bsdf.inputs['Roughness'])

    if bump > 0:
        btex = nt.nodes.new('ShaderNodeTexNoise')
        btex.inputs['Scale'].default_value = bump_scale
        btex.inputs['Detail'].default_value = 9.0
        bn = nt.nodes.new('ShaderNodeBump')
        bn.inputs['Strength'].default_value = bump
        bn.inputs['Distance'].default_value = 0.04
        # The large-scale pattern drives the bump too, so cobbles get grooves
        # where the colour changes rather than in an unrelated place.
        mixh = nt.nodes.new('ShaderNodeMix')
        mixh.data_type = 'FLOAT'
        mixh.inputs['Factor'].default_value = 0.55
        nt.links.new(btex.outputs['Fac'], mixh.inputs[2])
        nt.links.new(fac, mixh.inputs[3])
        nt.links.new(mixh.outputs[0], bn.inputs['Height'])
        nt.links.new(bn.outputs['Normal'], bsdf.inputs['Normal'])
    return mat


def emissive(name, colour, strength=6.0, base=None):
    """A glowing surface: emission plus a dark body so it still has form.

    Pure emission shaders read as flat stickers when they fill more than a few
    pixels, because they have no shading gradient at all. Keeping a real (dark)
    base colour under the emission means the drone's eye still looks spherical
    at CU.
    """
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    body = clamp_albedo(base if base else [c * 0.25 for c in colour])
    bsdf.inputs['Base Color'].default_value = (*body, 1.0)
    bsdf.inputs['Roughness'].default_value = 0.25
    bsdf.inputs['Emission Color'].default_value = (*colour, 1.0)
    bsdf.inputs['Emission Strength'].default_value = strength
    return mat


SMEAR_ATTR = 'ph_smear'


def rotor_smear(name, colour=(0.055, 0.065, 0.085), hub=0.015, rim=0.22):
    """A spinning rotor, modelled as what a camera actually records.

    A real blade at 6000 rpm is a translucent annulus, not a blade — and
    modelling blades would strobe against the frame rate. So: a disc that is
    nearly invisible at the hub and picks up opacity toward the rim, where the
    blade tip spends the most time at the highest speed.

    The radial ramp comes from a per-vertex float attribute baked by
    :func:`make_drone`, **not** from Generated texture coordinates. Generated
    coordinates are normalised to the whole object's bounding box, so on a
    one-object drone all four discs sample the same drone-wide gradient from
    wherever they happen to sit — the first version of this rendered four flat
    white plates. A baked attribute is per-vertex and therefore per-disc.
    """
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    mix = nt.nodes.new('ShaderNodeMixShader')
    trans = nt.nodes.new('ShaderNodeBsdfTransparent')
    glossy = nt.nodes.new('ShaderNodeBsdfPrincipled')
    glossy.inputs['Base Color'].default_value = (*clamp_albedo(colour), 1.0)
    glossy.inputs['Metallic'].default_value = 0.0
    glossy.inputs['Roughness'].default_value = 0.55
    attr = nt.nodes.new('ShaderNodeAttribute')
    attr.attribute_type = 'GEOMETRY'
    attr.attribute_name = SMEAR_ATTR
    mr = nt.nodes.new('ShaderNodeMapRange')
    mr.inputs['From Min'].default_value = 0.0
    mr.inputs['From Max'].default_value = 1.0
    mr.inputs['To Min'].default_value = hub
    mr.inputs['To Max'].default_value = rim
    mr.clamp = True
    nt.links.new(attr.outputs['Fac'], mr.inputs['Value'])
    nt.links.new(mr.outputs['Result'], mix.inputs['Fac'])
    nt.links.new(trans.outputs['BSDF'], mix.inputs[1])
    nt.links.new(glossy.outputs['BSDF'], mix.inputs[2])
    nt.links.new(mix.outputs['Shader'], out.inputs['Surface'])
    mat.use_backface_culling = False
    return mat


# ---------------------------------------------------------------------------
# Mesh plumbing
# ---------------------------------------------------------------------------


def _select_only(obj):
    """Make ``obj`` the sole selected + active object.

    ``bpy.ops`` operators act on the selection, and in a headless build the
    selection is whatever the last operator left behind. Being explicit here
    is the difference between shade-smoothing one object and shade-smoothing
    the whole forest.
    """
    for o in list(bpy.context.selected_objects):
        if o is not None:
            o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def _finish(obj, bevel_width=0.006, bevel_segments=2, bevel_angle=32.0,
            smooth_angle=38.0, bevel=True):
    """Shade smooth by angle, and round every hard edge.

    Both halves matter and they do different jobs:

    * Smooth-by-angle keeps a cube's corners crisp while removing the facets
      from a cylinder — flat shading everything shows the polygons at every
      shot size, smooth shading everything makes boxes look inflated.
    * The Bevel modifier is the real prize. A mathematically sharp convex edge
      catches *no* light: it has zero area, so it produces no highlight. Every
      manufactured object in the world has a 0.2 mm break on its edges, and
      that thin bright line is most of what tells the eye "this is a physical
      object". This is a geometric bevel, not ``ShaderNodeBevel`` — measured at
      +10% render time for the shader version and free for this one.
    """
    if bevel:
        mod = obj.modifiers.new('bevel', 'BEVEL')
        mod.limit_method = 'ANGLE'
        mod.angle_limit = math.radians(bevel_angle)
        mod.width = bevel_width
        mod.segments = bevel_segments
        mod.miter_outer = 'MITER_ARC'
        mod.harden_normals = False
    _select_only(obj)
    try:
        bpy.ops.object.shade_auto_smooth(angle=math.radians(smooth_angle))
    except Exception:                                    # pragma: no cover
        for poly in obj.data.polygons:
            poly.use_smooth = True
    return obj


def _obj_from_bm(name, bm, materials=()):
    me = bpy.data.meshes.new(name)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    for m in materials:
        me.materials.append(m)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def _ring(z, cx=0.0, cy=0.0, rx=1.0, ry=None, n=16, phase=0.0, lobes=None,
          matrix=None):
    """One horizontal ring of vertices.

    Nearly every part of every asset in this file is a stack of horizontal
    rings — trunks, limbs, torsos, heads. Building them all through one
    function is what keeps the module readable, and ``lobes`` (a function of
    angle returning a radius multiplier) is what keeps them from all being
    circles: root flares, deltoids and jawlines are all lobed rings.
    """
    ry = rx if ry is None else ry
    pts = []
    for i in range(n):
        a = phase + TAU * i / n
        k = lobes(a) if lobes else 1.0
        p = Vector((cx + math.cos(a) * rx * k, cy + math.sin(a) * ry * k, z))
        pts.append(matrix @ p if matrix else p)
    return pts


def _loft(bm, rings, cap_start=True, cap_end=True, mat=0):
    """Bridge equal-length rings into a tube and return the vertex lists."""
    layers = [[bm.verts.new(p) for p in ring] for ring in rings]
    n = len(layers[0])
    for a, b in zip(layers, layers[1:]):
        for i in range(n):
            j = (i + 1) % n
            try:
                f = bm.faces.new((a[i], a[j], b[j], b[i]))
                f.material_index = mat
            except ValueError:
                pass                       # duplicate face at a degenerate ring
    if cap_start and n > 2:
        try:
            bm.faces.new(tuple(reversed(layers[0]))).material_index = mat
        except ValueError:
            pass
    if cap_end and n > 2:
        try:
            bm.faces.new(tuple(layers[-1])).material_index = mat
        except ValueError:
            pass
    return layers


def _tube(bm, path, radii, n=10, mat=0, up=Vector((0.0, 0.0, 1.0)),
          cap_start=True, cap_end=True):
    """A tapered tube swept along an arbitrary 3-D path.

    Uses a fixed reference up-vector rather than a Frenet frame: branches here
    never loop back on themselves, and a fixed frame cannot twist or flip the
    way a curvature-derived one does at an inflection point.
    """
    rings = []
    for idx, p in enumerate(path):
        if idx == 0:
            tangent = (path[1] - path[0])
        elif idx == len(path) - 1:
            tangent = (path[-1] - path[-2])
        else:
            tangent = (path[idx + 1] - path[idx - 1])
        tangent = tangent.normalized()
        ref = up if abs(tangent.dot(up)) < 0.95 else Vector((1.0, 0.0, 0.0))
        side = tangent.cross(ref).normalized()
        other = side.cross(tangent).normalized()
        r = radii[idx]
        rings.append([p + side * (math.cos(TAU * i / n) * r)
                      + other * (math.sin(TAU * i / n) * r) for i in range(n)])
    return _loft(bm, rings, cap_start, cap_end, mat)


def _blob(bm, centre, radius, subdiv=2, squash=(1.0, 1.0, 1.0), seed=0,
          amp=0.22, freq=2.4, mat=0, rot=0.0):
    """An icosphere pushed around by noise.

    A bare icosphere is the most recognisable shape in computer graphics. Two
    octaves of value noise on the radius turn it into a mass with lobes and
    hollows, which at EWS is the entire difference between "a tree" and "a
    lollipop".
    """
    res = bmesh.new()
    bmesh.ops.create_icosphere(res, subdivisions=subdiv, radius=radius)
    rm = Matrix.Rotation(rot, 3, 'Z')
    for v in res.verts:
        d = v.co.normalized()
        k = _fbm((d * freq) + Vector((seed * 3.7, seed * 1.3, seed * 2.1)),
                 seed=seed, octaves=2)
        r = radius * (1.0 + amp * (k - 0.5) * 2.0)
        p = Vector((d.x * r * squash[0], d.y * r * squash[1],
                    d.z * r * squash[2]))
        v.co = rm @ p + Vector(centre)
    for f in res.faces:
        f.material_index = mat
    me = bpy.data.meshes.new('_tmp')
    res.to_mesh(me)
    res.free()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)


def _box(bm, centre, size, mat=0, rot=None):
    res = bmesh.new()
    bmesh.ops.create_cube(res, size=1.0)
    m = Matrix.Diagonal(Vector(size)).to_4x4()
    if rot is not None:
        m = rot.to_matrix().to_4x4() @ m
    m.translation = Vector(centre)
    bmesh.ops.transform(res, matrix=m, verts=res.verts)
    for f in res.faces:
        f.material_index = mat
    me = bpy.data.meshes.new('_tmp')
    res.to_mesh(me)
    res.free()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)


# ---------------------------------------------------------------------------
# Ground
# ---------------------------------------------------------------------------

_GROUND_LOOK = {
    # (colour A, colour B, roughness, bump, bump scale, sheen, texture, scale)
    'grass': ((0.055, 0.075, 0.032), (0.030, 0.048, 0.024), 0.92, 0.35, 55.0,
              0.30, 'NOISE', 3.2),
    'dirt': ((0.052, 0.038, 0.026), (0.026, 0.019, 0.014), 0.90, 0.45, 40.0,
             0.10, 'NOISE', 2.6),
    'cobble': ((0.075, 0.072, 0.068), (0.034, 0.033, 0.031), 0.72, 0.85, 26.0,
               0.05, 'VORONOI', 5.5),
    'stone': ((0.090, 0.088, 0.083), (0.048, 0.047, 0.045), 0.66, 0.30, 18.0,
              0.05, 'NOISE', 1.8),
    'plank': ((0.068, 0.044, 0.026), (0.036, 0.023, 0.014), 0.74, 0.28, 60.0,
              0.12, 'WAVE', 3.0),
}


def make_ground(size_x=30.0, size_y=30.0, kind='grass'):
    """A ground plane that is not a plane.

    Two things are going on:

    1. Real displacement. With a 4-degree key light, every grazing highlight
       in the frame comes from the ground's undulation; a mathematically flat
       floor throws all of it away and reads as a backdrop. The displacement
       is damped to zero over the middle ~7 m so the acting area stays level
       and characters' feet do not sink or float.
    2. Enough subdivision to carry it. 1 quad per 0.35 m, which at 44 x 44 m
       is ~16k faces — trivial next to a single tree.
    """
    kind = kind if kind in _GROUND_LOOK else 'grass'
    col_a, col_b, rough, bump, bump_sc, sheen, tex, tex_sc = _GROUND_LOOK[kind]

    cell = 0.35
    nx = max(8, min(200, int(size_x / cell)))
    ny = max(8, min(200, int(size_y / cell)))
    bm = bmesh.new()
    verts = []
    for iy in range(ny + 1):
        row = []
        for ix in range(nx + 1):
            x = (ix / nx - 0.5) * size_x
            y = (iy / ny - 0.5) * size_y
            # Two octaves: a long swell plus a smaller ripple.
            h = (_fbm((x * 0.055, y * 0.055, 0.0), seed=3, octaves=3) - 0.5) * 0.90
            h += (_fbm((x * 0.32, y * 0.32, 4.0), seed=11, octaves=2) - 0.5) * 0.14
            # Flatten the acting area: 0 at the centre, full by 9 m out.
            d = math.hypot(x, y)
            damp = min(1.0, max(0.0, (d - 3.5) / 5.5))
            damp = damp * damp * (3 - 2 * damp)
            row.append(bm.verts.new((x, y, h * damp)))
        verts.append(row)
    for iy in range(ny):
        for ix in range(nx):
            bm.faces.new((verts[iy][ix], verts[iy][ix + 1],
                          verts[iy + 1][ix + 1], verts[iy + 1][ix]))

    mat = _mix_colour_material(f'ground_{kind}', col_a, col_b, tex_sc, rough,
                               bump=bump, bump_scale=bump_sc, sheen=sheen,
                               texture=tex, distortion=0.6 if tex == 'WAVE' else 0.0)
    ob = _obj_from_bm(f'ground_{kind}', bm, [mat])
    # No bevel: a 16k-face grid has no hard edges to round and the modifier
    # would only cost memory.
    _finish(ob, bevel=False, smooth_angle=60.0)
    ob.is_shadow_catcher = False
    return ob


# ---------------------------------------------------------------------------
# Tree
# ---------------------------------------------------------------------------

_BARK = (0.040, 0.026, 0.016)
_LEAF = (0.021, 0.032, 0.010)
_UNDER = (0.028, 0.040, 0.013)


def make_tree(seed=0, scale=1.0):
    """A seeded tree: leaning tapered trunk, real branches, layered canopy.

    Why each piece exists, in order of how much it matters at EWS:

    * **The lean.** A vertical cylinder is a telegraph pole. Every trunk here
      leans 4-11 degrees and curves as it rises, so a stand of them makes a
      ragged, organic edge instead of a picket fence.
    * **Layered canopy masses.** Five to eight noise-deformed ellipsoids at
      different heights and radii, clustered around the branch tips rather
      than centred on the trunk. One icosphere reads as a lollipop from any
      distance; overlapping masses read as foliage because the silhouette has
      concavities.
    * **Root flare.** The bottom 40 cm swells into three or four buttresses via
      a lobed ring. This is the detail that sells the tree at MS, where the
      trunk fills a third of the frame and a perfect cylinder is obvious.
    * **Base litter.** A handful of ferns and fallen debris at the foot of
      every tree. Individually invisible; collectively they are the difference
      between a forest floor and a bare plane, and because they ride on the
      tree they scatter for free.
    """
    rng = Rng(seed * 7919 + 13)
    bark = jitter_colour(_BARK, rng, hue=0.015, sat=0.22, val=0.32)
    leaf = jitter_colour(_LEAF, rng, hue=0.035, sat=0.25, val=0.38)
    m_bark = principled(f'bark{seed}', bark, rough=0.88, rough_var=0.10,
                        noise_scale=26.0, bump=1.0, bump_scale=90.0)
    # Foliage is two-tone and heavily bumped at leaf scale. A canopy mass with
    # one flat albedo and a smooth normal reads as a boulder no matter how
    # good its silhouette is: what says "leaves" is high-frequency variation
    # in both colour and normal, and that is far cheaper as a shader than as
    # geometry.
    m_leaf = _mix_colour_material(
        f'leaf{seed}', leaf, [c * 0.52 for c in leaf], 26.0, 0.82,
        bump=1.0, bump_scale=110.0, sheen=0.36, detail=10.0, distortion=1.2)
    m_under = principled(f'under{seed}',
                         jitter_colour(_UNDER, rng, 0.04, 0.3, 0.4),
                         rough=0.88, rough_var=0.12, noise_scale=12.0, sheen=0.30)

    bm = bmesh.new()

    # Forest proportions, not parkland: tall, with the crown starting around
    # half height. A tree whose canopy sits on top of a bare pole reads as
    # savanna, and there is no savanna in this script.
    height = rng.range(4.7, 6.6)
    lean_dir = rng.range(0.0, TAU)
    lean = rng.range(0.05, 0.15)              # radians at the top
    r_base = rng.range(0.16, 0.23) * (height / 5.5)
    trunk_top = height * rng.range(0.72, 0.86)
    crown_base = height * rng.range(0.30, 0.42)

    # --- trunk: a lofted stack, leaning and curving -----------------------
    flare_phase = rng.range(0.0, TAU)
    flare_lobes = 3 + int(rng.next() * 2)
    steps = 15
    rings, spine = [], []
    for i in range(steps):
        t = i / (steps - 1)
        z = t * trunk_top
        # Lean grows with the height, so the base stays planted.
        sway = lean * trunk_top * (t ** 1.5)
        # A gentle S: the curve reverses in the upper third.
        sway -= lean * trunk_top * 0.26 * (t ** 3.2)
        cx = math.cos(lean_dir) * sway
        cy = math.sin(lean_dir) * sway
        r = r_base * (1.0 - 0.74 * t ** 1.45) * (1.0 + 0.08 * math.sin(t * 11.0 + seed))
        flare = max(0.0, 1.0 - t * 7.0) ** 2
        wob = 0.060 * (1.0 - 0.5 * t)

        def lobes(a, flare=flare, wob=wob, ph=flare_phase, nl=flare_lobes):
            return (1.0 + flare * 0.60 * max(0.0, math.sin(a * nl + ph))
                    + wob * math.sin(a * 7.0 + ph * 2.0))

        rings.append(_ring(z, cx, cy, r, n=14, lobes=lobes))
        spine.append(Vector((cx, cy, z)))
    _loft(bm, rings, cap_start=True, cap_end=False, mat=0)

    def spine_at(z):
        t = max(0.0, min(1.0, z / trunk_top))
        i = min(steps - 1, int(t * (steps - 1)))
        return spine[i].copy()

    # --- branches ---------------------------------------------------------
    # They climb steeply and only then reach outward, which is what a tree
    # competing for light in a wood actually does, and it is why the crown
    # ends up taller than it is wide.
    n_branch = 8 + int(rng.next() * 5)
    tips = []
    for b in range(n_branch):
        z0 = rng.range(crown_base * 0.85, trunk_top * 0.96)
        origin = spine_at(z0)
        a = rng.range(0.0, TAU)
        reach = rng.range(0.40, 0.95) * (height / 5.5) * (1.0 - 0.30 * (z0 / trunk_top))
        rise = reach * rng.range(0.85, 1.90)
        p1 = origin + Vector((math.cos(a) * reach * 0.30,
                              math.sin(a) * reach * 0.30, rise * 0.50))
        p2 = origin + Vector((math.cos(a) * reach * 0.72,
                              math.sin(a) * reach * 0.72, rise * 0.88))
        # The tip droops back down under its own leaf weight.
        p3 = origin + Vector((math.cos(a) * reach,
                              math.sin(a) * reach, rise * 0.96))
        br = r_base * rng.range(0.24, 0.40) * (1.0 - 0.35 * (z0 / trunk_top))
        _tube(bm, [origin, p1, p2, p3],
              [br, br * 0.70, br * 0.44, br * 0.20], n=7, mat=0)
        tips.append(p3)
        # Two twigs off each branch. They are one pixel wide at EWS and
        # invisible, but at MS they are the difference between a branch and a
        # length of dowel, and they let the crown edge fray instead of ending
        # in a clean arc.
        for k in range(2):
            ta = a + rng.range(-1.1, 1.1)
            tl = reach * rng.range(0.30, 0.55)
            base = p2.lerp(p3, rng.range(0.2, 0.9))
            _tube(bm, [base,
                       base + Vector((math.cos(ta) * tl * 0.6,
                                      math.sin(ta) * tl * 0.6,
                                      rise * rng.range(0.05, 0.30))),
                       base + Vector((math.cos(ta) * tl,
                                      math.sin(ta) * tl,
                                      rise * rng.range(0.10, 0.45)))],
                  [br * 0.34, br * 0.20, br * 0.07], n=5, mat=0)

    # --- canopy masses ----------------------------------------------------
    # An ellipsoid envelope taller than it is wide, filled with many small
    # overlapping masses. The union's silhouette is what the eye reads, and a
    # union of twelve lumps has the concavities that one smooth lump cannot.
    crown_top = height
    crown_mid = (crown_base + crown_top) * 0.5
    crown_h = (crown_top - crown_base) * 0.5
    # A wood, not an orchard: the crown is barely half as wide as it is tall.
    # A crown as wide as the tree is high is a parkland oak, and it turns a
    # forest into a row of lollipops however good the foliage itself is.
    crown_r = crown_h * rng.range(0.48, 0.66)

    n_mass = 16 + int(rng.next() * 8)
    for i in range(n_mass):
        if i < len(tips) and rng.next() < 0.80:
            anchor = tips[i]
            r = rng.range(0.30, 0.52) * (height / 5.5)
        else:
            # Somewhere in the envelope, biased to the shell so the crown is
            # hollow-ish and light gets through it.
            a = rng.range(0.0, TAU)
            u = rng.range(0.45, 1.0) ** 0.6
            zz = rng.range(-1.0, 1.0)
            ring_r = crown_r * u * math.sqrt(max(0.0, 1.0 - zz * zz))
            anchor = Vector((math.cos(a) * ring_r, math.sin(a) * ring_r,
                             crown_mid + zz * crown_h))
            # Follow the trunk's lean, so a leaning tree's crown leans with it
            # instead of hanging off to one side like a bad wig.
            drift = spine_at(anchor.z)
            anchor.x += drift.x
            anchor.y += drift.y
            # A wide size range on purpose. Equal-sized lumps read as a bunch
            # of grapes no matter how many there are; a few large masses with
            # small ones packed between them read as foliage.
            r = rng.range(0.30, 1.00) ** 1.4 * 0.95 * (height / 5.5)
        off = Vector((rng.range(-0.18, 0.18), rng.range(-0.18, 0.18),
                      rng.range(-0.16, 0.20)))
        # Stretched sideways and flattened: a bough of leaves is a plate, not
        # a ball, and plates stack into a crown with horizontal structure.
        # Higher noise frequency than feels natural on paper: at freq 2 the
        # lumps are half a metre across and the mass reads as a boulder; at
        # 5-8 they are the size of a bough of leaves.
        _blob(bm, anchor + off, r, subdiv=3,
              squash=(rng.range(1.10, 1.55), rng.range(1.00, 1.35),
                      rng.range(0.62, 0.92)),
              seed=seed * 31 + i, amp=rng.range(0.26, 0.40),
              freq=rng.range(4.5, 8.0), mat=1, rot=rng.range(0, TAU))
        # Two or three smaller clumps hanging off the mass. These do nothing
        # for the surface and everything for the outline: they are what stops
        # the crown edge being a sequence of smooth arcs.
        for k in range(2 + int(rng.next() * 3)):
            ca = rng.range(0.0, TAU)
            cz = rng.range(-0.55, 0.75)
            cr = r * rng.range(0.55, 0.92)
            sub = anchor + off + Vector((math.cos(ca) * cr, math.sin(ca) * cr,
                                         cz * cr))
            _blob(bm, sub, r * rng.range(0.40, 0.68), subdiv=2,
                  squash=(rng.range(1.05, 1.45), rng.range(1.0, 1.35),
                          rng.range(0.60, 0.95)),
                  seed=seed * 977 + i * 13 + k, amp=rng.range(0.24, 0.40),
                  freq=rng.range(4.0, 7.0), mat=1, rot=rng.range(0, TAU))

    # --- base litter and ferns -------------------------------------------
    for i in range(7 + int(rng.next() * 7)):
        a = rng.range(0.0, TAU)
        d = rng.range(r_base * 1.4, 1.8)
        base = Vector((math.cos(a) * d, math.sin(a) * d, 0.0))
        if rng.next() < 0.55:
            # A fern frond: a thin tapered blade that arcs over.
            ln = rng.range(0.25, 0.55)
            lift = rng.range(0.20, 0.42)
            fa = rng.range(0.0, TAU)
            path = [base,
                    base + Vector((math.cos(fa) * ln * 0.3,
                                   math.sin(fa) * ln * 0.3, lift * 0.75)),
                    base + Vector((math.cos(fa) * ln * 0.75,
                                   math.sin(fa) * ln * 0.75, lift)),
                    base + Vector((math.cos(fa) * ln,
                                   math.sin(fa) * ln, lift * 0.80))]
            w = rng.range(0.030, 0.055)
            _tube(bm, path, [w, w * 0.9, w * 0.6, w * 0.15], n=5, mat=2)
        else:
            # Debris: a flattened lump of leaf litter.
            _blob(bm, base + Vector((0, 0, 0.03)), rng.range(0.10, 0.24),
                  subdiv=1, squash=(1.4, 1.1, 0.22), seed=seed * 17 + i,
                  amp=0.45, freq=2.0, mat=2, rot=rng.range(0, TAU))

    ob = _obj_from_bm(f'tree{seed}', bm, [m_bark, m_leaf, m_under])
    # A tiny bevel with a wide angle limit: the trunk cap and the branch
    # junctions are the only genuinely hard edges, and they are exactly where
    # a rim light lands on a backlit tree.
    # A wide smoothing angle: the canopy masses are noise-displaced, so their
    # face-to-face angles routinely exceed 45 degrees, and anything tighter
    # leaves them faceted like cut gemstones.
    _finish(ob, bevel_width=0.010, bevel_segments=2, bevel_angle=62.0,
            smooth_angle=68.0)
    ob.scale = (scale, scale, scale)
    return ob


# ---------------------------------------------------------------------------
# Drone
# ---------------------------------------------------------------------------


def make_drone(scale=1.0):
    """A quadrotor, origin at its lowest point (the sensor gimbal).

    ``base`` for a hovering object means "the bottom of the model", so the
    translator can set ``location.z`` to the hover height in the scene file
    and get the machine's belly at that height.

    Built along +Y, which is where the sensor eye points, so heading rotation
    aims the camera the way a reader of the scene file expects.

    The rotors are smear discs rather than blades — see :func:`rotor_smear`.
    """
    m_shell = principled('drone_shell', (0.030, 0.034, 0.040), rough=0.42,
                         metal=0.72, rough_var=0.16, noise_scale=38.0)
    m_dark = principled('drone_dark', (0.010, 0.011, 0.013), rough=0.55,
                        metal=0.35, rough_var=0.14, noise_scale=55.0)
    m_eye = emissive('drone_eye', (1.0, 0.17, 0.10), strength=3.0,
                     base=(0.06, 0.01, 0.01))
    m_strobe = emissive('drone_strobe', (0.30, 1.0, 0.45), strength=5.0,
                        base=(0.02, 0.06, 0.03))
    m_smear = rotor_smear('drone_rotor')

    bm = bmesh.new()
    # (first vertex index, per-ring normalised radius). Indices, not vertex
    # references: bmesh invalidates BMVert pointers whenever from_mesh() grows
    # the arena, and _blob/_box call it after these are built.
    disc_rings = []
    # Everything is authored around a body plane at z = 0 and shifted at the
    # end, because arm/rotor maths is far clearer that way.
    core = []
    for i, (z, r, sq, cy) in enumerate([
            (-0.075, 0.055, (1.5, 1.05), 0.010),
            (-0.045, 0.105, (1.55, 1.10), 0.008),
            (-0.010, 0.135, (1.55, 1.12), 0.004),
            (0.022, 0.128, (1.48, 1.08), 0.000),
            (0.050, 0.098, (1.34, 0.98), -0.006),
            (0.072, 0.050, (1.15, 0.85), -0.010)]):
        core.append(_ring(z, 0.0, cy, r * sq[0], r * sq[1], n=18))
    _loft(bm, core, mat=0)

    # A darker canopy shell over the top gives the silhouette a definite
    # front, which is what lets an audience tell where a drone is looking.
    can = []
    for z, r in [(0.036, 0.115), (0.058, 0.098), (0.076, 0.062), (0.086, 0.020)]:
        can.append(_ring(z, 0.0, 0.012, r * 1.35, r * 1.02, n=16))
    _loft(bm, can, cap_start=False, mat=1)

    for i in range(4):
        a = TAU * i / 4 + math.pi / 4
        ax, ay = math.cos(a) * 0.245, math.sin(a) * 0.245
        # Arm: a tapered tube from the hull out to the motor pod.
        _tube(bm, [Vector((ax * 0.28, ay * 0.28, 0.004)),
                   Vector((ax * 0.70, ay * 0.70, 0.004)),
                   Vector((ax, ay, 0.006))],
              [0.026, 0.020, 0.024], n=8, mat=0)
        # Motor pod.
        pod = [_ring(-0.006, ax, ay, 0.040, n=12),
               _ring(0.016, ax, ay, 0.044, n=12),
               _ring(0.034, ax, ay, 0.034, n=12)]
        _loft(bm, pod, mat=1)
        # Landing skid stub, so the machine reads as a real vehicle.
        _tube(bm, [Vector((ax * 0.92, ay * 0.92, -0.010)),
                   Vector((ax * 1.02, ay * 1.02, -0.070))],
              [0.011, 0.009], n=6, mat=1)
        # Rotor smear disc: a very shallow lens, hub to rim and back.
        # A single sheet, not a closed lens. A lens is two surfaces, and a
        # camera ray crossing both doubles the effective opacity — which is
        # what turned an intended 20% smear into a solid white plate.
        radii = [0.010, 0.055, 0.098, 0.118, 0.122]
        disc = [_ring(z, ax, ay, r, n=24) for z, r in
                zip((0.0448, 0.0452, 0.0456, 0.0458, 0.0456), radii)]
        first = len(bm.verts)
        _loft(bm, disc, cap_start=False, cap_end=False, mat=4)
        disc_rings.append((first, [(r / 0.122) ** 1.6 for r in radii], 24))

    # Sensor gimbal, slung under the nose and pointing +Y.
    gim = []
    for z, r in [(-0.140, 0.028), (-0.120, 0.050), (-0.095, 0.058),
                 (-0.072, 0.052), (-0.058, 0.030)]:
        gim.append(_ring(z, 0.0, 0.048, r * 1.05, r, n=14))
    _loft(bm, gim, mat=1)
    # Eye: a lens barrel plus the glowing element itself.
    _tube(bm, [Vector((0.0, 0.070, -0.112)), Vector((0.0, 0.101, -0.112))],
          [0.030, 0.027], n=14, mat=1)
    _blob(bm, (0.0, 0.104, -0.112), 0.024, subdiv=2, squash=(1.0, 0.55, 1.0),
          seed=5, amp=0.02, mat=2)
    # Tail strobe.
    _blob(bm, (0.0, -0.150, 0.030), 0.017, subdiv=1, amp=0.05, mat=3)
    # Antenna: a thin spike that breaks the silhouette at WS.
    _tube(bm, [Vector((0.055, -0.130, 0.030)), Vector((0.070, -0.165, 0.180))],
          [0.005, 0.002], n=5, mat=1)

    # Bake the rotors' hub-to-rim ramp. Done last, because the _blob and _box
    # helpers merge whole meshes in and would not carry the layer.
    smear = bm.verts.layers.float.new(SMEAR_ATTR)
    bm.verts.ensure_lookup_table()
    for first, ramp, n in disc_rings:
        for ring, t in enumerate(ramp):
            for k in range(n):
                bm.verts[first + ring * n + k][smear] = t

    ob = _obj_from_bm('drone', bm, [m_shell, m_dark, m_eye, m_strobe, m_smear])
    # Push the origin to the lowest point of the model.
    lowest = min(v.co.z for v in ob.data.vertices)
    for v in ob.data.vertices:
        v.co.z -= lowest
    # Boxier than the trees, and shot in a CU insert: worth a real bevel.
    _finish(ob, bevel_width=0.0035, bevel_segments=2, bevel_angle=28.0,
            smooth_angle=34.0)
    ob.scale = (scale, scale, scale)
    ob['ph_kind'] = 'drone'
    return ob


# ---------------------------------------------------------------------------
# Rifle
# ---------------------------------------------------------------------------


def make_rifle(scale=1.0):
    """A carbine, barrel along +Y, origin at the lowest point.

    Silhouette is the whole job: a rifle is only ever seen in profile against
    a bright sky at MS or wider, so stock, magazine, optic and a long barrel
    have to be individually readable at 30 px tall. Detail below that scale is
    wasted, so there is none.

    ``obj['ph_grip']`` is the local-space point a hand should hold, which the
    translator needs because the origin is at the model's base rather than in
    the palm.
    """
    m_metal = principled('rifle_metal', (0.016, 0.018, 0.021), rough=0.38,
                         metal=0.85, rough_var=0.16, noise_scale=60.0)
    m_furn = principled('rifle_furniture', (0.030, 0.026, 0.021), rough=0.62,
                        rough_var=0.14, noise_scale=48.0, sheen=0.10)

    bm = bmesh.new()
    # Butt stock. Boxes, not a lofted ellipse: an elliptical cross-section
    # swept along the barrel axis renders as a fat tube, and a rifle whose
    # stock reads as a tube reads as a rocket launcher. A stock is flat-sided.
    _box(bm, (0.0, -0.190, -0.006), (0.036, 0.100, 0.084), mat=1)   # butt pad
    _box(bm, (0.0, -0.105, 0.004), (0.036, 0.090, 0.062), mat=1)    # comb
    _box(bm, (0.0, -0.148, -0.048), (0.030, 0.110, 0.028), mat=1,
         rot=Euler((math.radians(9), 0, 0)))                        # underline

    _box(bm, (0.0, 0.010, 0.004), (0.044, 0.215, 0.082), mat=0)     # receiver
    _box(bm, (0.0, 0.040, 0.052), (0.026, 0.180, 0.020), mat=0)     # top rail
    # Pistol grip, raked back.
    _box(bm, (0.0, -0.052, -0.075), (0.034, 0.052, 0.105), mat=1,
         rot=Euler((math.radians(-16), 0, 0)))
    # Magazine, raked forward.
    _box(bm, (0.0, 0.048, -0.092), (0.030, 0.056, 0.135), mat=0,
         rot=Euler((math.radians(14), 0, 0)))
    # Trigger guard.
    _box(bm, (0.0, -0.006, -0.058), (0.020, 0.052, 0.010), mat=0)
    # Handguard: a slim slab around the barrel, not a sleeve over it.
    _box(bm, (0.0, 0.185, -0.006), (0.036, 0.150, 0.052), mat=1)
    # Barrel and muzzle.
    _tube(bm, [Vector((0, 0.10, 0.008)), Vector((0, 0.40, 0.008)),
               Vector((0, 0.445, 0.008))],
          [0.013, 0.0105, 0.015], n=12, mat=0)
    # Optic: a real tube on a mount, sitting proud of the rail. At MS this is
    # a 3-pixel bump, and it is the bump that says "weapon" rather than "pipe".
    _tube(bm, [Vector((0, -0.015, 0.098)), Vector((0, 0.010, 0.098)),
               Vector((0, 0.075, 0.098)), Vector((0, 0.098, 0.098))],
          [0.019, 0.015, 0.015, 0.020], n=12, mat=0)
    _box(bm, (0.0, 0.040, 0.074), (0.016, 0.036, 0.028), mat=0)
    # Sling loops break up the profile at the two ends.
    _tube(bm, [Vector((0.020, -0.160, -0.030)), Vector((0.020, -0.160, -0.055))],
          [0.005, 0.005], n=6, mat=0)

    ob = _obj_from_bm('rifle', bm, [m_metal, m_furn])
    lowest = min(v.co.z for v in ob.data.vertices)
    for v in ob.data.vertices:
        v.co.z -= lowest
    # Almost entirely box-derived, so this is precisely the asset the bevel
    # research said to spend edge rounding on.
    _finish(ob, bevel_width=0.0030, bevel_segments=2, bevel_angle=26.0,
            smooth_angle=30.0)
    ob.scale = (scale, scale, scale)
    ob['ph_grip'] = (0.0, -0.052, -0.075 - lowest)
    ob['ph_kind'] = 'rifle'
    return ob


# ---------------------------------------------------------------------------
# Character
# ---------------------------------------------------------------------------

# Proportion multipliers, mirroring human.js BUILDS so a spec written for the
# browser produces a recognisably similar figure here.
BUILDS = {
    'slim': {'shoulder': 0.94, 'waist': 0.88, 'hip': 0.94, 'chest': 0.92, 'limb': 0.90},
    'average': {'shoulder': 1.00, 'waist': 1.00, 'hip': 1.00, 'chest': 1.00, 'limb': 1.00},
    'sturdy': {'shoulder': 1.10, 'waist': 1.16, 'hip': 1.10, 'chest': 1.10, 'limb': 1.12},
    'willowy': {'shoulder': 0.92, 'waist': 0.84, 'hip': 1.00, 'chest': 0.94, 'limb': 0.92},
    'broad': {'shoulder': 1.16, 'waist': 1.06, 'hip': 1.02, 'chest': 1.12, 'limb': 1.10},
}

# Bone names are anim.js's names verbatim. Anything else and the pose library
# silently does nothing.
BONE_ORDER = [
    'hips', 'spine', 'chest', 'neck', 'head',
    'clavL', 'upperArmL', 'foreArmL', 'handL',
    'clavR', 'upperArmR', 'foreArmR', 'handR',
    'thighL', 'shinL', 'footL', 'toeL',
    'thighR', 'shinR', 'footR', 'toeR',
]

_PARENT = {
    'spine': 'hips', 'chest': 'spine', 'neck': 'chest', 'head': 'neck',
    'clavL': 'chest', 'upperArmL': 'clavL', 'foreArmL': 'upperArmL', 'handL': 'foreArmL',
    'clavR': 'chest', 'upperArmR': 'clavR', 'foreArmR': 'upperArmR', 'handR': 'foreArmR',
    'thighL': 'hips', 'shinL': 'thighL', 'footL': 'shinL', 'toeL': 'footL',
    'thighR': 'hips', 'shinR': 'thighR', 'footR': 'shinR', 'toeR': 'footR',
}


def _skeleton(height, build):
    """Rest-pose bone head/tail positions for a figure of a given height.

    Proportions are the classical 7.5-head canon, which is what a stylised
    figure wants: 8 heads reads heroic/fashion-plate and 7 reads squat. Height
    1.78 m gives a 0.237 m head.

    The bind pose has the arms hanging straight down and every bone's rest
    orientation axis-aligned with the world. That is not an aesthetic choice —
    anim.js's pose library is authored against exactly that bind pose, so any
    other rest pose would need every one of its numbers re-derived.
    """
    h = height
    sh = build['shoulder']
    hp = build['hip']
    limb = build['limb']
    shoulder_z = h * 0.8175
    hip_z = h * 0.5620
    return {
        'hips':      ((0, 0, hip_z), (0, 0, hip_z + h * 0.055)),
        'spine':     ((0, 0, hip_z + h * 0.055), (0, 0, h * 0.700)),
        'chest':     ((0, 0, h * 0.700), (0, 0, h * 0.828)),
        # The head bone starts just above the chin (h - h/7.5 = 0.8667 h), so
        # a nod rotates the skull about the atlas rather than about the collar.
        'neck':      ((0, 0, h * 0.828), (0, 0, h * 0.880)),
        'head':      ((0, 0, h * 0.880), (0, 0, h * 0.985)),

        'clavL':     ((h * 0.017, 0, h * 0.812), (h * 0.088 * sh, 0, shoulder_z)),
        'upperArmL': ((h * 0.096 * sh, 0, shoulder_z),
                      (h * 0.096 * sh, 0, shoulder_z - h * 0.183 * limb)),
        'foreArmL':  ((h * 0.096 * sh, 0, shoulder_z - h * 0.183 * limb),
                      (h * 0.096 * sh, 0, shoulder_z - h * 0.320 * limb)),
        'handL':     ((h * 0.096 * sh, 0, shoulder_z - h * 0.320 * limb),
                      (h * 0.096 * sh, 0, shoulder_z - h * 0.415 * limb)),

        'clavR':     ((-h * 0.017, 0, h * 0.812), (-h * 0.088 * sh, 0, shoulder_z)),
        'upperArmR': ((-h * 0.096 * sh, 0, shoulder_z),
                      (-h * 0.096 * sh, 0, shoulder_z - h * 0.183 * limb)),
        'foreArmR':  ((-h * 0.096 * sh, 0, shoulder_z - h * 0.183 * limb),
                      (-h * 0.096 * sh, 0, shoulder_z - h * 0.320 * limb)),
        'handR':     ((-h * 0.096 * sh, 0, shoulder_z - h * 0.320 * limb),
                      (-h * 0.096 * sh, 0, shoulder_z - h * 0.415 * limb)),

        'thighL':    ((h * 0.047 * hp, 0, hip_z * 0.96), (h * 0.047 * hp, 0, h * 0.278)),
        'shinL':     ((h * 0.047 * hp, 0, h * 0.278), (h * 0.048 * hp, 0, h * 0.052)),
        'footL':     ((h * 0.048 * hp, 0, h * 0.052), (h * 0.048 * hp, h * 0.075, h * 0.012)),
        'toeL':      ((h * 0.048 * hp, h * 0.075, h * 0.012),
                      (h * 0.048 * hp, h * 0.135, h * 0.012)),

        'thighR':    ((-h * 0.047 * hp, 0, hip_z * 0.96), (-h * 0.047 * hp, 0, h * 0.278)),
        'shinR':     ((-h * 0.047 * hp, 0, h * 0.278), (-h * 0.048 * hp, 0, h * 0.052)),
        'footR':     ((-h * 0.048 * hp, 0, h * 0.052), (-h * 0.048 * hp, h * 0.075, h * 0.012)),
        'toeR':      ((-h * 0.048 * hp, h * 0.075, h * 0.012),
                      (-h * 0.048 * hp, h * 0.135, h * 0.012)),
    }


def _weight_part(mesh, index_range, bones, skel, obj, falloff=3.0, keep=3):
    """Assign skin weights for one body part, from a whitelist of bones.

    Global nearest-bone weighting is what produces the classic "the hip claims
    the wrist" collapse: a hand hanging beside the pelvis is genuinely closer
    to the hip bone than to some of the arm bones. Whitelisting per part makes
    that impossible, and costs one list literal per part. It is the same trick
    the browser rig (human.js) uses with its ``allowed`` lists.
    """
    groups = {}
    for b in bones:
        groups[b] = obj.vertex_groups.get(b) or obj.vertex_groups.new(name=b)
    start, end = index_range
    for vi in range(start, end):
        p = mesh.vertices[vi].co
        scored = []
        for b in bones:
            head, tail = (Vector(skel[b][0]), Vector(skel[b][1]))
            seg = tail - head
            t = 0.0 if seg.length_squared == 0 else max(
                0.0, min(1.0, (p - head).dot(seg) / seg.length_squared))
            d = (p - (head + seg * t)).length
            scored.append((d, b))
        scored.sort()
        scored = scored[:keep]
        weights = [(1.0 / max(d, 1e-4) ** falloff, b) for d, b in scored]
        total = sum(w for w, _ in weights) or 1.0
        for w, b in weights:
            if w / total > 0.002:
                groups[b].add([vi], w / total, 'REPLACE')


class _Part:
    """A chunk of character mesh plus the bones allowed to deform it."""

    def __init__(self, bm, bones):
        self.start = len(bm.verts)
        self.bones = bones


def make_character(spec=None, name='actor'):
    """A stylised humanoid with a working armature.

    The brief is a *correct silhouette and readable posture*, not a good face:
    at MS and wider — which is nine of the ten shots in forest-stop — a face
    is under 40 px and what actually communicates is shoulder line, stance and
    the angle of the head. So the modelling effort goes into:

    * shoulder mass and a real clavicle, so ``handsUp`` reads as surrender
      rather than as a T-pose;
    * a coat/jacket shell that hangs past the hip, which is what makes the
      guards read as guards in silhouette;
    * boots and a belt, because a leg that fades into the ground has no
      length and a torso with no waist has no weight.

    ``spec`` mirrors the scene file: ``{build, outfitType, primary, secondary,
    accent, skin, hairColour, height}``. Returns the *armature* object, so
    ``obj.location`` and ``obj.rotation_euler.z`` place and turn the figure and
    :func:`pose_character` can act on the same handle.
    """
    spec = spec or {}
    build = BUILDS.get(spec.get('build'), BUILDS['average'])
    height = float(spec.get('height') or 1.0)
    height = 1.78 * (height if 0.5 < height < 1.5 else 1.0)
    skel = _skeleton(height, build)
    outfit = (spec.get('outfitType') or spec.get('outfit') or 'workwear')

    skin = hex_rgb(spec.get('skin'), (0.30, 0.17, 0.11))
    primary = hex_rgb(spec.get('primary'), (0.09, 0.11, 0.09))
    secondary = hex_rgb(spec.get('secondary'), (0.05, 0.06, 0.05))
    accent = hex_rgb(spec.get('accent'), (0.04, 0.04, 0.05))
    hair = hex_rgb(spec.get('hairColour'), (0.030, 0.020, 0.014))

    m_skin = principled(f'{name}_skin', skin, rough=0.52, rough_var=0.10,
                        noise_scale=90.0, sheen=0.12, subsurface=0.16,
                        sss_radius=(0.36, 0.14, 0.09), bump=0.10,
                        bump_scale=180.0)
    m_prim = principled(f'{name}_cloth', primary, rough=0.74, rough_var=0.14,
                        noise_scale=45.0, sheen=0.34, bump=0.28, bump_scale=90.0)
    m_sec = principled(f'{name}_cloth2', secondary, rough=0.78, rough_var=0.13,
                       noise_scale=40.0, sheen=0.30, bump=0.26, bump_scale=80.0)
    m_acc = principled(f'{name}_leather', accent, rough=0.48, rough_var=0.16,
                       noise_scale=55.0, sheen=0.10, bump=0.30, bump_scale=120.0)
    m_hair = principled(f'{name}_hair', hair, rough=0.62, rough_var=0.15,
                        noise_scale=30.0, sheen=0.45, bump=0.55, bump_scale=140.0)
    m_dark = principled(f'{name}_eye', (0.012, 0.010, 0.010), rough=0.22,
                        rough_var=0.05)
    mats = [m_skin, m_prim, m_sec, m_acc, m_hair, m_dark]
    SKIN, PRIM, SEC, ACC, HAIR, DARK = range(6)

    h = height
    sh, wa, hp, ch = (build['shoulder'], build['waist'], build['hip'],
                      build['chest'])
    limb = build['limb']
    shoulder_z = h * 0.8175

    bm = bmesh.new()
    parts = []

    def begin(bones):
        p = _Part(bm, bones)
        parts.append(p)
        return p

    def end(p):
        p.end = len(bm.verts)

    # --- torso -----------------------------------------------------------
    # A jacket, not a body: everything from the hips to the collar is cloth,
    # so the silhouette is the garment's and there is no skin/cloth
    # interpenetration to solve.
    p = begin(['hips', 'spine', 'chest', 'neck', 'clavL', 'clavR'])
    torso_long = outfit in ('coat', 'robe', 'gown')
    # One shell from hem to collar. An earlier version built the coat skirt as
    # a *second* lofted cone overlapping the jacket, and the two surfaces
    # intersected into a hard black flap sticking out at hip height — the kind
    # of error that is invisible in a wireframe and unmissable in a render.
    # Widths are anthropometric fractions of stature: hips 0.18 h across,
    # waist 0.15 h, biacromial 0.185 h. The deltoid and the sleeve add the
    # rest, which is how a real shoulder gets to 0.26 h without the ribcage
    # being that wide. Building the ribcage at the finished shoulder width is
    # the single commonest way a stylised figure ends up looking inflated.
    # The last column is how far the coat has parted at that height, 0 at the
    # belt to 1 at the hem. It has to RAMP: a first version switched the
    # parting on between two adjacent rings and the discontinuity rendered as
    # a hard rectangular tab sticking out of the hip.
    profile = [
        # (z fraction of height, half-width, half-depth, y offset, part)
        (0.395, 0.118 * hp, 0.090 * hp, 0.004, 1.00),
        (0.450, 0.112 * hp, 0.086 * hp, 0.003, 0.72),
        (0.505, 0.108 * hp, 0.080 * hp, 0.002, 0.40),
        (0.548, 0.105 * hp, 0.076 * hp, 0.002, 0.14),
    ] if torso_long else [
        (0.505, 0.107 * hp, 0.078 * hp, 0.000, 0.0),
        (0.548, 0.104 * hp, 0.075 * hp, 0.002, 0.0),
    ]
    profile += [
        (0.590, 0.096 * hp, 0.068 * hp, 0.005, 0.0),
        (0.632, 0.076 * wa, 0.055 * wa, 0.006, 0.0),
        (0.678, 0.079 * wa, 0.058 * wa, 0.004, 0.0),
        (0.722, 0.086 * ch, 0.064 * ch, -0.002, 0.0),
        (0.772, 0.091 * ch, 0.067 * ch, -0.006, 0.0),
        (0.812, 0.092 * sh, 0.063 * ch, -0.008, 0.0),
        (0.832, 0.072 * sh, 0.052 * ch, -0.006, 0.0),
        (0.850, 0.048, 0.043, -0.002, 0.0),
    ]
    torso = []
    for frac, hw, hd, yo, part in profile:
        def lobes(a, part=part):
            # A slightly squared cross-section, because a pure ellipse of
            # revolution reads as a bottle rather than a ribcage.
            k = 1.0 + 0.09 * abs(math.cos(2 * a)) ** 2
            # Below the belt a coat parts over the front of the legs. The
            # falloff is a raised cosine rather than a clamped one: clamping
            # at max(0, cos) puts a slope discontinuity at the two sides,
            # which rendered as a hard-cornered rectangular panel on each hip.
            k -= 0.13 * part * ((1.0 + math.cos(a - math.pi / 2)) * 0.5) ** 3
            return k
        torso.append(_ring(frac * h, 0.0, yo * h, hw * h, hd * h, n=20,
                           lobes=lobes))
    _loft(bm, torso, cap_start=True, cap_end=False, mat=PRIM)
    # Torso-side half of the shoulder ball. The arm carries the other half.
    # One ball on either side of the joint is what keeps the socket closed
    # through 152 degrees of abduction: a single ball on the torso gets left
    # behind by the sleeve, and a single ball on the arm swings away from the
    # torso. Both, overlapping, are always closed.
    for s in (1, -1):
        _blob(bm, (s * h * 0.092 * sh, -h * 0.004, shoulder_z - h * 0.014),
              h * 0.036 * sh, subdiv=3, squash=(1.00, 1.05, 1.10),
              seed=int(s) + 21, amp=0.04, mat=PRIM)
    end(p)

    # Belt.
    p = begin(['hips', 'spine'])
    belt = []
    for z, k in [(0.600, 1.012), (0.616, 1.026), (0.630, 1.010)]:
        belt.append(_ring(z * h, 0.0, 0.005 * h, 0.083 * wa * h * k,
                          0.061 * wa * h * k, n=20))
    _loft(bm, belt, cap_start=False, cap_end=False, mat=ACC)
    end(p)

    # --- head and neck ---------------------------------------------------
    # The head is one canonical head-unit tall (h / 7.5) measured chin to
    # crown, and about two thirds of that wide. Getting this ratio wrong is
    # the fastest way to make a figure read as a child or as a bobblehead, and
    # it is far more visible at MS than any amount of facial detail.
    hu = h / 7.5
    chin_z = h - hu
    p = begin(['neck', 'head', 'chest'])
    neck = []
    for z, r in [(h * 0.828, 0.052), (h * 0.845, 0.048), (chin_z, 0.046)]:
        neck.append(_ring(z, 0.0, -0.004 * h, r * h, r * h * 0.90, n=14))
    _loft(bm, neck, cap_start=False, cap_end=False, mat=SKIN)

    face = spec.get('face') or {}
    jaw_k = float(face.get('jaw', 1.0))
    skull = []
    for t, rw, rd, yo in [
            (0.00, 0.115 * jaw_k, 0.150, 0.030),
            (0.09, 0.190 * jaw_k, 0.255, 0.038),
            (0.20, 0.255 * jaw_k, 0.330, 0.030),
            (0.33, 0.292, 0.376, 0.012),
            (0.47, 0.315, 0.400, 0.000),
            (0.60, 0.328, 0.406, -0.008),
            (0.73, 0.328, 0.386, -0.018),
            (0.85, 0.296, 0.338, -0.026),
            (0.94, 0.222, 0.244, -0.026),
            (1.00, 0.090, 0.100, -0.020)]:
        def lobes(a):
            # Flatten the back of the skull very slightly, and square off the
            # sides: a perfect ellipse of revolution reads as an egg.
            return (1.0 - 0.05 * max(0.0, -math.sin(a))
                    + 0.05 * abs(math.cos(a)) ** 3)
        skull.append(_ring(chin_z + t * hu, 0.0, yo * hu,
                           rw * hu, rd * hu, n=16, lobes=lobes))
    _loft(bm, skull, cap_start=False, cap_end=True, mat=SKIN)
    # Nose: tiny, but its shadow is what gives a head a direction at MS, which
    # is the only thing a face has to do in nine of these ten shots.
    _blob(bm, (0.0, hu * 0.345, chin_z + hu * 0.44), hu * 0.085, subdiv=2,
          squash=(0.55, 1.45, 1.20), seed=2, amp=0.10, mat=SKIN)
    # Brow ridge.
    _blob(bm, (0.0, hu * 0.300, chin_z + hu * 0.685), hu * 0.20, subdiv=2,
          squash=(1.45, 0.42, 0.28), seed=4, amp=0.10, mat=SKIN)
    # Ears.
    for s in (1, -1):
        _blob(bm, (s * hu * 0.325, -hu * 0.02, chin_z + hu * 0.545),
              hu * 0.105, subdiv=1, squash=(0.30, 0.70, 1.30), seed=6,
              amp=0.16, mat=SKIN)
    # Eyes, set into the sockets. Dark, glossy and small: a catchlight in one
    # of these is worth more than a modelled eyelid.
    for s in (1, -1):
        _blob(bm, (s * hu * 0.135, hu * 0.265, chin_z + hu * 0.590),
              hu * 0.058, subdiv=2, squash=(1.0, 0.80, 0.80), seed=8,
              amp=0.02, mat=DARK)
    end(p)

    # Hair: a cap that follows the skull, sits proud of it, and dips at the
    # nape. It is deliberately not flat on top — a flat top reads as a hat.
    p = begin(['head'])
    cap = []
    for t, k, kd in [(0.545, 1.030, 1.020), (0.66, 1.045, 1.035),
                     (0.78, 1.055, 1.040), (0.88, 1.055, 1.030),
                     (0.955, 1.070, 1.055), (1.005, 0.62, 0.66)]:
        rw = {0.545: 0.328, 0.66: 0.328, 0.78: 0.322, 0.88: 0.288,
              0.955: 0.210, 1.005: 0.090}[t]
        rd = {0.545: 0.404, 0.66: 0.400, 0.78: 0.382, 0.88: 0.330,
              0.955: 0.232, 1.005: 0.100}[t]

        def lobes(a):
            # Full at the back and sides, cut away over the brow.
            return 1.0 + 0.14 * max(0.0, -math.sin(a)) - 0.10 * max(0.0, math.sin(a)) ** 2

        cap.append(_ring(chin_z + t * hu, 0.0, -hu * 0.02,
                         rw * k * hu, rd * kd * hu, n=20, lobes=lobes))
    _loft(bm, cap, cap_start=False, cap_end=True, mat=HAIR)
    end(p)

    # --- arms -------------------------------------------------------------
    for side, s in (('L', 1), ('R', -1)):
        p = begin([f'clav{side}', f'upperArm{side}', f'foreArm{side}',
                   f'hand{side}'])
        ax = s * h * 0.096 * sh
        # Arm-side half of the shoulder ball.
        _blob(bm, (ax, -h * 0.004, shoulder_z - h * 0.008),
              h * 0.034 * sh, subdiv=3, squash=(1.05, 1.10, 1.12),
              seed=int(s) + 9, amp=0.04, mat=PRIM)
        sleeve = []
        for frac, r in [(0.0, 0.041), (0.16, 0.038), (0.38, 0.032),
                        (0.50, 0.029), (0.62, 0.031), (0.78, 0.026),
                        (0.90, 0.022)]:
            z = shoulder_z - frac * h * 0.415 * limb
            rr = r * limb
            sleeve.append(_ring(z, ax, 0.0, rr * h, rr * h * 0.94, n=12))
        _loft(bm, sleeve, cap_start=True, cap_end=False, mat=PRIM)
        # Cuff.
        _loft(bm, [_ring(shoulder_z - 0.86 * h * 0.415 * limb, ax, 0.0,
                         0.025 * limb * h, 0.023 * limb * h, n=12),
                   _ring(shoulder_z - 0.90 * h * 0.415 * limb, ax, 0.0,
                         0.024 * limb * h, 0.022 * limb * h, n=12)],
              cap_start=False, cap_end=False, mat=ACC)
        # Hand: a mitten mass plus a thumb. Fingers are invisible past MCU and
        # a splayed hand model reads worse than a closed one at every size.
        hz = shoulder_z - h * 0.375 * limb
        _blob(bm, (ax, 0.004 * h, hz - h * 0.024), h * 0.026 * limb, subdiv=2,
              squash=(0.62, 1.05, 1.55), seed=12, amp=0.10, mat=SKIN)
        _blob(bm, (ax - s * h * 0.017, 0.012 * h, hz - h * 0.010),
              h * 0.012 * limb, subdiv=1, squash=(0.9, 1.3, 1.1), seed=14,
              amp=0.10, mat=SKIN)
        end(p)

    # --- legs -------------------------------------------------------------
    for side, s in (('L', 1), ('R', -1)):
        p = begin([f'thigh{side}', f'shin{side}', f'foot{side}', f'toe{side}',
                   'hips'])
        lx = s * h * 0.047 * hp
        leg = []
        for z, r in [(0.545, 0.050), (0.470, 0.048), (0.380, 0.043),
                     (0.290, 0.036), (0.245, 0.038), (0.180, 0.034),
                     (0.110, 0.027), (0.062, 0.023)]:
            rr = r * limb
            leg.append(_ring(z * h, lx, 0.0, rr * h, rr * h * 0.96, n=12))
        _loft(bm, leg, cap_start=True, cap_end=False, mat=SEC)
        # Boot: shaft plus a foot wedge that actually has a toe and a heel.
        boot = []
        for z, r, yo in [(0.115, 0.035, 0.0), (0.075, 0.038, 0.004),
                         (0.040, 0.041, 0.012), (0.018, 0.040, 0.020)]:
            rr = r * limb
            boot.append(_ring(z * h, lx, yo * h, rr * h, rr * h * 1.12, n=12))
        _loft(bm, boot, cap_start=False, cap_end=False, mat=ACC)
        # The shoe is a swept profile, not an ellipsoid. An ellipsoid foot
        # reads as a slipper, and at WS the foot is the only thing joining a
        # figure to the ground — get it wrong and everyone hovers.
        u = h / 1.78
        shoe = []
        for y, hw, top, bot in [(-0.078, 0.032, 0.086, 0.012),
                                (-0.045, 0.044, 0.100, 0.000),
                                (0.005, 0.048, 0.086, 0.000),
                                (0.062, 0.047, 0.062, 0.000),
                                (0.115, 0.041, 0.042, 0.002),
                                (0.155, 0.028, 0.026, 0.008),
                                (0.172, 0.012, 0.018, 0.012)]:
            shoe.append(_ring(0.0, 0.0, 0.0, hw * u, (top - bot) * 0.5 * u,
                              n=12,
                              matrix=(Matrix.Translation(
                                  (lx, y * u, (top + bot) * 0.5 * u))
                                  @ Matrix.Rotation(math.radians(90), 4, 'X'))))
        _loft(bm, shoe, mat=ACC)
        end(p)

    ob = _obj_from_bm(f'{name}_body', bm, mats)

    # --- armature ---------------------------------------------------------
    arm_data = bpy.data.armatures.new(f'{name}_rig')
    rig = bpy.data.objects.new(name, arm_data)
    bpy.context.scene.collection.objects.link(rig)
    _select_only(rig)
    bpy.ops.object.mode_set(mode='EDIT')
    ebs = {}
    for bname in BONE_ORDER:
        head, tail = skel[bname]
        eb = arm_data.edit_bones.new(bname)
        eb.head = head
        eb.tail = tail
        # Roll 0 everywhere: the pose conversion in pose_character reads each
        # bone's rest matrix, so roll only has to be *consistent*, and 0 is the
        # easiest value to reason about when debugging a bad pose.
        eb.roll = 0.0
        ebs[bname] = eb
    for child, parent in _PARENT.items():
        ebs[child].parent = ebs[parent]
        ebs[child].use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')

    for part in parts:
        _weight_part(ob.data, (part.start, part.end), part.bones, skel, ob)

    ob.parent = rig
    mod = ob.modifiers.new('armature', 'ARMATURE')
    mod.object = rig

    _finish(ob, bevel_width=0.0035, bevel_segments=2, bevel_angle=38.0,
            smooth_angle=50.0)

    for pb in rig.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    rig['ph_kind'] = 'character'
    rig['ph_height'] = height
    rig['ph_body'] = ob.name
    pose_character(rig, 'idle')
    return rig


# ---------------------------------------------------------------------------
# Posing
# ---------------------------------------------------------------------------

# anim.js POSES, verbatim, in degrees. Kept as a literal rather than parsed
# from the JS so a Blender render never depends on a JS toolchain being
# present — but they must be edited together, and the numbers are the contract.
POSES = {
    'idle': {
        'upperArmL': (-4, 0, 6), 'foreArmL': (-14, 0, 3),
        'upperArmR': (-4, 0, -6), 'foreArmR': (-14, 0, -3),
        'spine': (1, 0, 0), 'chest': (-1, 0, 0), 'neck': (2, 0, 0),
    },
    'listen': {
        'upperArmL': (-8, 0, 8), 'foreArmL': (-38, 0, 6),
        'upperArmR': (-8, 0, -8), 'foreArmR': (-38, 0, -6),
        'spine': (2, 0, 0), 'chest': (-2, 0, 0), 'neck': (4, 0, 3),
        'head': (2, 0, 4),
    },
    'talk': {
        'upperArmL': (-16, 0, 14), 'foreArmL': (-58, 0, 10),
        'upperArmR': (-6, 0, -8), 'foreArmR': (-22, 0, -4),
        'spine': (1, -3, 0), 'chest': (-2, 2, 0), 'neck': (2, 2, 0),
    },
    'run': {
        'upperArmL': (-62, 0, 10), 'foreArmL': (-92, 0, 8),
        'upperArmR': (38, 0, -10), 'foreArmR': (-78, 0, -8),
        'spine': (14, 0, 0), 'chest': (6, 0, 0), 'neck': (-12, 0, 0),
        'head': (-6, 0, 0), 'hips': (4, 0, 0),
    },
    'handsUp': {
        # Arms to ~115 degrees with the elbows folded hard, so the hands sit
        # beside the ears rather than straight overhead. Straight arms read as a
        # touchdown signal; bent ones read as surrender.
        'upperArmL': (-14, 0, 115), 'foreArmL': (-95, 0, 16),
        'upperArmR': (-14, 0, -115), 'foreArmR': (-95, 0, -16),
        'clavL': (0, 0, 16), 'clavR': (0, 0, -16),
        'spine': (-6, 0, 0), 'chest': (-3, 0, 0), 'neck': (6, 0, 0),
        'head': (4, 0, 0),
    },
    'aim': {
        'upperArmR': (-74, -18, -22), 'foreArmR': (-58, 0, -6),
        'upperArmL': (-82, 22, 16), 'foreArmL': (-42, 0, 4),
        'spine': (4, -10, 0), 'chest': (-2, 8, 0), 'neck': (0, 6, 0),
        'head': (-2, 4, 0),
    },
    'flinch': {
        'upperArmL': (-42, 0, 10), 'foreArmL': (-96, 0, 12),
        'upperArmR': (-42, 0, -10), 'foreArmR': (-96, 0, -12),
        'clavL': (0, 0, 12), 'clavR': (0, 0, -12),
        'spine': (12, 0, 0), 'chest': (8, 0, 0), 'neck': (10, 0, 0),
        'head': (8, 0, 0),
    },
}

# Legs, which anim.js drives procedurally from locomotion state and therefore
# does not store in POSES. A still frame has no locomotion state, so a runner
# posed from the table alone stands bolt upright with his arms pumping — which
# looks like a man having a seizure, not a man running. These layers supply
# the stance the browser gets from its walk cycle.
_LEG_LAYER = {
    'run': {
        'thighL': (-38, 0, 2), 'shinL': (46, 0, 0), 'footL': (-14, 0, 0),
        'thighR': (30, 0, -2), 'shinR': (34, 0, 0), 'footR': (16, 0, 0),
    },
    'aim': {
        'thighL': (-12, 0, 5), 'shinL': (16, 0, 0), 'footL': (-4, 0, 0),
        'thighR': (10, 0, -8), 'shinR': (12, 0, 0), 'footR': (-2, 0, 0),
        'hips': (0, -14, 0),
    },
    'flinch': {
        'thighL': (-14, 0, 6), 'shinL': (22, 0, 0), 'footL': (-8, 0, 0),
        'thighR': (6, 0, -6), 'shinR': (10, 0, 0),
    },
    'handsUp': {
        'thighL': (-4, 0, 4), 'shinL': (7, 0, 0),
        'thighR': (-2, 0, -5), 'shinR': (5, 0, 0),
    },
    'idle': {
        'thighL': (-2, 0, 3), 'shinL': (4, 0, 0),
        'thighR': (1, 0, -4), 'shinR': (3, 0, 0), 'hips': (0, -3, 0),
    },
}
_LEG_LAYER['listen'] = _LEG_LAYER['idle']
_LEG_LAYER['talk'] = _LEG_LAYER['idle']


def _three_euler_to_blender(tx, ty, tz):
    """Convert an anim.js bone euler (degrees) into a Blender world rotation.

    anim.js works in three.js space: +Y up, and the character faces +Z with
    their own left hand toward +X (verified against human.js, where side 'L'
    is the +X side, and against the pose table itself — ``bow`` bends the
    spine by +34 about X, which must be *forward*).

    Blender space here is +Z up with the character facing +Y, so the mapping
    of basis vectors is::

        three +X (the actor's left) -> blender -X
        three +Y (up)               -> blender +Z
        three +Z (forward)          -> blender +Y

    A rotation about three-axis ``a`` becomes a rotation about ``M @ a`` by the
    same angle, which gives axis X -> -X, Y -> +Z, Z -> +Y. three.js composes
    its default 'XYZ' euler as Rx @ Ry @ Rz, so the product is composed in the
    same order here.
    """
    rx = Matrix.Rotation(math.radians(-tx), 3, 'X')
    ry = Matrix.Rotation(math.radians(ty), 3, 'Z')
    rz = Matrix.Rotation(math.radians(tz), 3, 'Y')
    return rx @ ry @ rz


def pose_character(obj, pose='idle', intensity=1.0):
    """Apply a named pose from anim.js's library.

    Poses are authored as rotations *in world axes relative to the parent*,
    because the bind pose has every bone axis-aligned. Blender's
    ``matrix_basis`` is in the bone's own rest space instead, so each rotation
    is conjugated by that bone's rest matrix::

        basis = rest^-1 @ R_world @ rest

    Doing it this way means the bone roll and rest orientation can be whatever
    is convenient for modelling without any of the pose numbers changing.

    ``intensity`` scales every angle, which is how a half-flinch or a soft
    idle is expressed without a second table.
    """
    rig = obj
    if rig is None:
        return None
    if rig.type != 'ARMATURE':
        rig = next((c for c in rig.children if c.type == 'ARMATURE'),
                   rig.parent if rig.parent and rig.parent.type == 'ARMATURE'
                   else None)
    if rig is None or rig.type != 'ARMATURE':
        return None

    table = dict(POSES.get(pose) or POSES['idle'])
    for bone, euler in (_LEG_LAYER.get(pose) or {}).items():
        table.setdefault(bone, euler)

    for pb in rig.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)

    for bone, (tx, ty, tz) in table.items():
        pb = rig.pose.bones.get(bone)
        if pb is None:
            continue
        r = _three_euler_to_blender(tx * intensity, ty * intensity,
                                    tz * intensity)
        rest = pb.bone.matrix_local.to_3x3()
        pb.rotation_quaternion = (rest.inverted() @ r @ rest).to_quaternion()

    rig['ph_pose'] = pose
    if bpy.context.view_layer:
        bpy.context.view_layer.update()
    return rig


# ---------------------------------------------------------------------------
# World
# ---------------------------------------------------------------------------

MOODS = {
    # horizon, zenith, sky strength, sun elev, sun temp, sun energy, disc deg,
    # fog colour, fog density multiplier
    'DAY': ((0.52, 0.50, 0.48), (0.11, 0.20, 0.44), 3.2, 44.0, 5200, 9.0, 1.5,
            (0.76, 0.78, 0.84), 0.34),
    'DUSK': ((0.30, 0.17, 0.10), (0.055, 0.085, 0.17), 3.0, 4.0, 2400, 9.0, 3.0,
             (0.62, 0.66, 0.78), 0.52),
    'DAWN': ((0.26, 0.19, 0.20), (0.060, 0.100, 0.20), 3.0, 6.0, 2900, 8.0, 3.0,
             (0.68, 0.70, 0.80), 1.15),
    'NIGHT': ((0.030, 0.042, 0.075), (0.008, 0.014, 0.036), 1.0, 24.0, 8600,
              0.55, 4.0, (0.52, 0.60, 0.82), 0.85),
    'STORM': ((0.085, 0.090, 0.100), (0.038, 0.042, 0.052), 1.3, 26.0, 6800,
              1.3, 8.0, (0.60, 0.62, 0.66), 1.6),
}

# Energy of the broad ambient fill, per mood.
#
# This is a correction to the original recipe, found by rendering the forest
# scene with the fog switched off: the frame was black on black. The key is
# deliberately backlit (165 degrees off the lens) and the cool kick is
# light-linked to the cast, which leaves *the entire environment* — trees,
# ground, props — lit by nothing but the sky gradient. At DUSK that gradient
# is (0.30, 0.17, 0.10) at strength 1.0, which is essentially no light at all.
#
# The recipe passed its own review because it was judged on a compact lineup
# where fog filled the background and the eye read the haze as illumination.
# Over a 44 m stage the same fog just turns the frame into an orange wash with
# silhouettes in it, and turning the fog down reveals that there was never any
# light on the set. A wide, soft, slightly cool fill from over the camera's
# shoulder is the missing element; it is what a real unit would bounce in.
# Ambient belongs in SKY strength, not in a fill sun. A fill sun is flat and
# self-occludes nothing, so it floods out the roughness and bump detail the
# materials already carry. Sky lighting darkens canopy interiors and the contact
# under each figure for free, and lets the low key rake across the displaced
# ground the way the ground mesh was built to be lit.
_AMBIENT = {
    'DAY': 0.6,
    'DUSK': 0.5,
    'DAWN': 0.5,
    'NIGHT': 0.12,
    'STORM': 0.5,
}


def _sky_world(name, horizon, zenith, strength):
    """A vertical gradient sky.

    A flat background colour is the single difference between "dusk" and "a
    grey studio". The warm-low / cool-high split also gives every shadow a
    colour rather than making it a hole, which is most of what stops CG
    shadows looking like cut-outs.
    """
    world = bpy.data.worlds.new(name)
    world.use_nodes = True
    nt = world.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputWorld')
    bg = nt.nodes.new('ShaderNodeBackground')
    bg.inputs['Strength'].default_value = strength
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    mr = nt.nodes.new('ShaderNodeMapRange')
    mr.inputs['From Min'].default_value = -0.15
    mr.inputs['From Max'].default_value = 0.42
    mr.clamp = True
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (*horizon, 1.0)
    ramp.color_ramp.elements[1].color = (*zenith, 1.0)
    # A third stop just above the horizon keeps the gradient from being a
    # linear wash, which is what makes a procedural sky look procedural.
    mid = ramp.color_ramp.elements.new(0.30)
    mid.color = (*[(a * 0.62 + b * 0.38) for a, b in zip(horizon, zenith)], 1.0)
    nt.links.new(tc.outputs['Generated'], sep.inputs['Vector'])
    nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
    nt.links.new(mr.outputs['Result'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
    nt.links.new(bg.outputs['Background'], out.inputs['Surface'])
    return world


def set_world(mood='DUSK', fog=0.0, scene=None, heading_deg=0.0,
              fog_size=(34.0, 34.0, 9.0), fog_centre=(0.0, 2.0, 3.0),
              cast_objects=(), ambient=None):
    """Sky, key light, cool kick, ambient fill and a bounded fog volume.

    Returns ``{'world', 'sun', 'kick', 'fill', 'fog'}`` so the translator can
    re-aim every light per shot — the sun is placed 165 degrees off the
    *camera's* heading, i.e. backlit and just off axis, which measured as the
    single biggest change in the whole look study after the tonemap. Aiming it
    once for the whole scene would leave half the shots frontally lit.

    ``ambient`` overrides the per-mood fill energy (see :data:`_AMBIENT`).
    Pass 0.0 to get the original backlight-only rig back.

    ``fog`` is the scene file's density. It is the only expensive thing in the
    entire recipe (+75% render time), and it is a **bounded cube**: a world
    volume renders a completely black frame at every density tested, because
    an unbounded medium extinguishes an infinitely distant sun, and it is not
    cheaper either.
    """
    scene = scene or bpy.context.scene
    (horizon, zenith, strength, elev, temp, energy, disc,
     fog_col, fog_k) = MOODS.get(mood, MOODS['DUSK'])

    world = _sky_world(f'sky_{mood}', horizon, zenith, strength)
    scene.world = world

    sun_data = bpy.data.lights.new('key', 'SUN')
    sun_data.energy = energy
    # 3 degrees, not the physical 0.53: at 0.53 the shadow edges are razor
    # sharp and read as CG. Softening them costs nothing.
    sun_data.angle = math.radians(disc)
    sun_data.color = kelvin_rgb(temp)
    sun = bpy.data.objects.new('key', sun_data)
    scene.collection.objects.link(sun)
    sun['ph_elev'] = elev
    aim_key_light(sun, heading_deg)

    # A cool frontal fill, light-linked to the cast. Measured at 1.8 in the
    # research rig it flooded the figures teal and turned skin to plastic; at
    # roughly half that it does its actual job, which is to keep a backlit
    # face from being a silhouette without ever becoming the key.
    kick_data = bpy.data.lights.new('kick', 'SUN')
    kick_data.energy = 1.1 if mood != 'NIGHT' else 0.4
    kick_data.angle = math.radians(14.0)
    kick_data.color = kelvin_rgb(6800)
    kick = bpy.data.objects.new('kick', kick_data)
    scene.collection.objects.link(kick)
    aim_kick_light(kick, heading_deg)
    if cast_objects:
        link_kick(kick, cast_objects, scene)

    # The environment fill. Unlike the kick this is deliberately NOT light
    # linked: the trees and the ground are the things that were unlit, and a
    # fill that only touches the cast leaves the set black. Its 60-degree disc
    # makes it read as bounced sky rather than a second sun.
    fill = None
    energy = _AMBIENT.get(mood, 2.0) if ambient is None else float(ambient)
    if energy > 0.0:
        fill_data = bpy.data.lights.new('fill', 'SUN')
        fill_data.energy = energy
        fill_data.angle = math.radians(60.0)
        fill_data.color = kelvin_rgb(6200)
        fill = bpy.data.objects.new('fill', fill_data)
        scene.collection.objects.link(fill)
        aim_fill_light(fill, heading_deg)

    fog_obj = None
    if fog and fog > 0.0:
        fog_obj = add_fog(scene, density=fog * fog_k, colour=fog_col,
                          size=fog_size, centre=fog_centre)
    return {'world': world, 'sun': sun, 'kick': kick, 'fill': fill,
            'fog': fog_obj}


def aim_key_light(sun, heading_deg, offset=165.0, elev=None):
    """Point the key 165 degrees off the camera heading — i.e. backlit.

    Swinging the sun from frontal to backlit was measured as a bigger change
    than the choice of tonemap. 165 rather than a flat 180 keeps it just off
    axis so it rakes across the subject rather than flaring straight into the
    lens.
    """
    e = sun.get('ph_elev', 4.0) if elev is None else elev
    sun.rotation_euler = (math.radians(90.0 - e), 0.0,
                          math.radians(heading_deg + offset))
    return sun


def aim_kick_light(kick, heading_deg, offset=-28.0, elev=26.0):
    """Point the cool fill just off the camera's own axis.

    The key and the fill are BOTH per-shot: the key is 165 degrees from the
    camera heading and the fill is 28 degrees the other way, so a shot that
    reverses the camera has to re-aim both or the fill lands on the back of
    the actor's head and the close-up is a black cut-out.
    """
    kick.rotation_euler = (math.radians(90.0 - elev), 0.0,
                           math.radians(heading_deg + offset))
    return kick


def aim_fill_light(fill, heading_deg, offset=-42.0, elev=48.0):
    """Point the broad environment fill high and over the camera's shoulder.

    High enough (48 degrees) that it reads as sky rather than as a second key,
    and swung to the opposite side from the kick so a subject gets modelling
    from both three-quarter directions instead of one flat frontal wash.
    """
    fill.rotation_euler = (math.radians(90.0 - elev), 0.0,
                           math.radians(heading_deg + offset))
    return fill


def link_kick(kick, cast_objects, scene=None):
    """Restrict the kick light to the cast.

    Not optional. Unlinked, this light illuminates the fog volume and produces
    a glowing blob with no source in frame. Linking removes it entirely and
    costs nothing.
    """
    scene = scene or bpy.context.scene
    rec = bpy.data.collections.new('kick_receivers')
    scene.collection.children.link(rec)
    for o in cast_objects:
        try:
            rec.objects.link(o)
        except RuntimeError:
            pass
        for c in o.children:
            try:
                rec.objects.link(c)
            except RuntimeError:
                pass
    kick.light_linking.receiver_collection = rec
    return rec


def add_fog(scene=None, density=0.022, anisotropy=0.66,
            colour=(0.62, 0.66, 0.78), size=(34.0, 34.0, 9.0),
            centre=(0.0, 2.0, 3.0)):
    """A bounded volume box. Never a world volume — see :func:`set_world`.

    Anisotropy 0.75 forward-scatters toward the camera, which is exactly what
    makes a backlit haze glow instead of just greying the image down.
    """
    scene = scene or bpy.context.scene
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    box = _obj_from_bm('fog', bm)
    box.scale = size
    box.location = centre
    box.visible_shadow = False          # the fog must not shadow the sun

    mat = bpy.data.materials.new('fog')
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    sc = nt.nodes.new('ShaderNodeVolumeScatter')
    sc.inputs['Density'].default_value = density
    sc.inputs['Anisotropy'].default_value = anisotropy
    sc.inputs['Color'].default_value = (*colour, 1.0)
    # Break the density up so the haze has structure rather than being a
    # uniform grey wash: real fog in trees pools and thins.
    tex = nt.nodes.new('ShaderNodeTexNoise')
    tex.inputs['Scale'].default_value = 0.12
    tex.inputs['Detail'].default_value = 4.0
    mr = nt.nodes.new('ShaderNodeMapRange')
    mr.inputs['To Min'].default_value = density * 0.55
    mr.inputs['To Max'].default_value = density * 1.45
    nt.links.new(tex.outputs['Fac'], mr.inputs['Value'])
    nt.links.new(mr.outputs['Result'], sc.inputs['Density'])
    nt.links.new(sc.outputs['Volume'], out.inputs['Volume'])
    box.data.materials.append(mat)

    scene.cycles.volume_step_rate = 1.0
    scene.cycles.volume_max_steps = 1024
    return box


# ---------------------------------------------------------------------------
# The film look
# ---------------------------------------------------------------------------


def apply_film_look(scene=None, samples=64, resolution=None, exposure=-0.2,
                    vignette=0.35, grain=0.010, bloom=0.30,
                    motion_blur=True):
    """The whole measured recipe in one call.

    Every number here came out of a rendered A/B, not out of memory. In rough
    order of how much difference it makes:

    1. AgX. Standard clips a sunlit haze to a flat saturated orange blob and
       Filmic desaturates the entire frame to grey-brown; AgX rolls highlights
       off toward white the way film stock does.
    2. Fast GI: *saves* 39% (79s -> 49s at 960x540 / s64) with no visible loss,
       because a scene lit by one sun through haze has almost no multi-bounce
       light to lose.
    3. Grain. OpenImageDenoise at 48+ samples returns surfaces with literally
       zero high-frequency content, which reads as wax. 0.010 of noise puts
       back about what the denoiser took out (measured inter-pixel delta 0.69
       denoised, 1.82 with grain, 1.21 for the raw render).
    4. Vignette and a little bloom.

    Blender 5.0 note: ``scene.node_tree`` and ``CompositorNodeComposite`` no
    longer exist. The compositor is a node *group* assigned to
    ``scene.compositing_node_group`` and terminated by a ``NodeGroupOutput``.
    """
    scene = scene or bpy.context.scene

    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    if resolution:
        scene.render.resolution_x, scene.render.resolution_y = resolution
        scene.render.resolution_percentage = 100

    scene.cycles.samples = samples
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.04
    scene.cycles.max_bounces = 6
    scene.cycles.diffuse_bounces = 3
    scene.cycles.glossy_bounces = 3
    scene.cycles.transmission_bounces = 3
    scene.cycles.transparent_max_bounces = 4
    scene.cycles.volume_bounces = 1
    scene.cycles.caustics_reflective = False
    scene.cycles.caustics_refractive = False
    scene.cycles.use_fast_gi = True
    scene.cycles.fast_gi_method = 'REPLACE'
    scene.cycles.ao_bounces_render = 1
    scene.cycles.use_denoising = True
    scene.cycles.denoising_prefilter = 'ACCURATE'
    scene.cycles.denoising_quality = 'HIGH'
    scene.cycles.denoising_input_passes = 'RGB_ALBEDO_NORMAL'
    scene.cycles.denoising_use_gpu = False

    # 180-degree shutter. Only does anything if the exporter writes keys on
    # the frames either side with LINEAR interpolation; costs +7% regardless.
    scene.render.use_motion_blur = bool(motion_blur)
    scene.render.motion_blur_shutter = 0.5

    scene.view_settings.view_transform = 'AgX'
    try:
        scene.view_settings.look = 'AgX - Medium High Contrast'
    except (TypeError, ValueError):                      # pragma: no cover
        pass
    scene.view_settings.exposure = exposure
    scene.view_settings.gamma = 1.0

    _add_compositor(scene, vignette=vignette, grain=grain, bloom=bloom)
    return scene


def _add_compositor(scene, vignette=0.35, grain=0.010, bloom=0.30):
    scene.use_nodes = True
    ng = bpy.data.node_groups.new('ph_comp', 'CompositorNodeTree')
    ng.interface.new_socket('Image', in_out='OUTPUT',
                            socket_type='NodeSocketColor')
    scene.compositing_node_group = ng
    rl = ng.nodes.new('CompositorNodeRLayers')
    rl.scene = scene
    gout = ng.nodes.new('NodeGroupOutput')
    cur = rl.outputs['Image']

    if bloom > 0:
        g = ng.nodes.new('CompositorNodeGlare')
        # These two are menu sockets taking DISPLAY names, not enum ids.
        g.inputs['Type'].default_value = 'Bloom'
        g.inputs['Quality'].default_value = 'Medium'
        g.inputs['Strength'].default_value = bloom
        g.inputs['Threshold'].default_value = 1.0
        g.inputs['Size'].default_value = 7.0
        ng.links.new(cur, g.inputs['Image'])
        cur = g.outputs['Image']

    if vignette > 0:
        ic = ng.nodes.new('CompositorNodeImageCoordinates')
        ng.links.new(rl.outputs['Image'], ic.inputs['Image'])
        sep = ng.nodes.new('ShaderNodeSeparateXYZ')
        ng.links.new(ic.outputs['Normalized'], sep.inputs['Vector'])
        vec = ng.nodes.new('ShaderNodeCombineXYZ')
        for axis in ('X', 'Y'):
            m = ng.nodes.new('ShaderNodeMath')
            m.operation = 'SUBTRACT'
            m.inputs[1].default_value = 0.5
            ng.links.new(sep.outputs[axis], m.inputs[0])
            ng.links.new(m.outputs[0], vec.inputs[axis])
        ln = ng.nodes.new('ShaderNodeVectorMath')
        ln.operation = 'LENGTH'
        ng.links.new(vec.outputs['Vector'], ln.inputs[0])
        mr = ng.nodes.new('ShaderNodeMapRange')
        mr.inputs['From Min'].default_value = 0.22
        mr.inputs['From Max'].default_value = 0.72
        mr.inputs['To Min'].default_value = 1.0
        mr.inputs['To Max'].default_value = 1.0 - vignette
        mr.clamp = True
        ng.links.new(ln.outputs['Value'], mr.inputs['Value'])
        conv = ng.nodes.new('ShaderNodeMix')
        conv.data_type = 'RGBA'
        conv.inputs['Factor'].default_value = 1.0
        ng.links.new(mr.outputs['Result'], conv.inputs[7])
        mul = ng.nodes.new('ShaderNodeMix')
        mul.data_type = 'RGBA'
        mul.blend_type = 'MULTIPLY'
        mul.inputs['Factor'].default_value = 1.0
        ng.links.new(cur, mul.inputs[6])
        ng.links.new(conv.outputs[2], mul.inputs[7])
        cur = mul.outputs[2]

    if grain > 0:
        ic2 = ng.nodes.new('CompositorNodeImageCoordinates')
        ng.links.new(rl.outputs['Image'], ic2.inputs['Image'])
        wn = ng.nodes.new('ShaderNodeTexWhiteNoise')
        wn.noise_dimensions = '3D'
        ng.links.new(ic2.outputs['Pixel'], wn.inputs['Vector'])
        centre = ng.nodes.new('ShaderNodeMath')
        centre.operation = 'SUBTRACT'
        centre.inputs[1].default_value = 0.5
        ng.links.new(wn.outputs['Value'], centre.inputs[0])
        amt = ng.nodes.new('ShaderNodeMath')
        amt.operation = 'MULTIPLY'
        amt.inputs[1].default_value = grain
        ng.links.new(centre.outputs[0], amt.inputs[0])
        gcol = ng.nodes.new('ShaderNodeMix')
        gcol.data_type = 'RGBA'
        gcol.inputs['Factor'].default_value = 1.0
        ng.links.new(amt.outputs[0], gcol.inputs[7])
        add = ng.nodes.new('ShaderNodeMix')
        add.data_type = 'RGBA'
        add.blend_type = 'ADD'
        add.inputs['Factor'].default_value = 1.0
        ng.links.new(cur, add.inputs[6])
        ng.links.new(gcol.outputs[2], add.inputs[7])
        cur = add.outputs[2]

    ng.links.new(cur, gout.inputs[0])
    return ng
