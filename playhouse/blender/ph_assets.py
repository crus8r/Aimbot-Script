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
    make_slab / make_rod / make_orb (seed, scale, colour, size) -> object
        the generic dressing shapes, plus a dozen named types built on them
        (make_crate, make_table, make_cup, ...) -- see that section's header
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

# bpy first, out of alphabetical order on purpose: outside Blender's own
# interpreter these are pip's `bpy` wheel, which only registers bmesh and
# mathutils as it initialises. `import bmesh` above `import bpy` raises
# ModuleNotFoundError, which reads as "Blender is not installed" and is not.
import bpy
import bmesh
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


def _spin(bm, rng):
    """Turn a mesh about its own vertical axis by a seeded angle.

    Yaw jitter has to be baked into the vertices, not written to the object:
    ``render_scene.place`` sets ``rotation_euler[2]`` from the scene file's
    ``facing`` and would drop it. Without this a row of buckets lines every
    handle and every lofted seam up the same way, which is the giveaway that
    one loop placed all of them.
    """
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0.0, 0.0, 0.0),
                     matrix=Matrix.Rotation(rng.range(0.0, TAU), 3, 'Z'))


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
    # Sand is the brightest ground here by a wide margin, and deliberately so:
    # its whole character is that it bounces a great deal of light back up
    # into everything standing on it. The two tones are dry and damp sand, and
    # the fine bump at a high scale is what makes a low sun rake across it.
    'sand': ((0.310, 0.255, 0.180), (0.160, 0.135, 0.105), 0.80, 0.22, 120.0,
             0.06, 'NOISE', 1.4),
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
# Small dressing props
#
# These exist because the asset library is the vocabulary the director can
# speak in: a scene file may ask for anything, but only `make_<type>` names
# actually build. A scene saying "a beach with buckets and a ball scattered
# about" needs a bucket and a ball to exist before any amount of direction
# will put one on screen.
#
# They are deliberately cheap. Dressing sits in the background of a wide shot
# and is read as a coloured shape at twenty pixels; the budget belongs in the
# silhouette and in a saturated albedo that survives the fog, not in detail
# nobody will resolve.
# ---------------------------------------------------------------------------


def _scallop(count, depth):
    """A `lobes` callable that ripples a ring's radius `count` times round."""
    return lambda a: 1.0 + depth * math.cos(a * count)


def make_ball(seed=0, scale=1.0):
    """A beach ball: bright, banded, and slightly settled into the ground.

    The bands are the point. A single-coloured sphere in a background reads as
    a rendering artifact -- a bubble, a lens flare, a hole in the mesh --
    because nothing outdoors is a uniform circle. Two alternating colours make
    it read as an object at any size.
    """
    rng = Rng(seed * 7919 + 41)
    hue = rng.pick([(0.62, 0.10, 0.09), (0.14, 0.30, 0.60),
                    (0.72, 0.55, 0.08), (0.10, 0.42, 0.24)])
    m_a = principled(f'ball_a{seed}', hue, rough=0.30, rough_var=0.08,
                     noise_scale=70.0)
    m_b = principled(f'ball_b{seed}', (0.74, 0.72, 0.68), rough=0.30,
                     rough_var=0.08, noise_scale=70.0)

    radius = 0.17
    bm = bmesh.new()
    _blob(bm, (0.0, 0.0, radius * 0.94), radius, subdiv=3, amp=0.015,
          seed=seed, mat=0)
    ob = _obj_from_bm(f'ball{seed}', bm, [m_a, m_b])
    # Bands by latitude, assigned after the mesh exists because _blob writes a
    # single material index over everything it makes.
    for poly in ob.data.polygons:
        z = (poly.center.z - radius * 0.94) / radius
        poly.material_index = 1 if int((z + 1.0) * 3.0) % 2 else 0
    _finish(ob, bevel=False, smooth_angle=180.0)
    ob.scale = (scale, scale, scale)
    ob['ph_kind'] = 'ball'
    return ob


def make_bucket(seed=0, scale=1.0):
    """A child's sand bucket: a tapered open cylinder with a handle.

    Open at the top, which is why it is lofted rather than blobbed -- a solid
    lump the same size reads as a rock, and the dark ellipse of the opening is
    the entire cue that says "container".
    """
    rng = Rng(seed * 7919 + 97)
    hue = rng.pick([(0.66, 0.16, 0.06), (0.10, 0.34, 0.62),
                    (0.76, 0.58, 0.06), (0.44, 0.14, 0.50)])
    m_body = principled(f'bucket{seed}', hue, rough=0.34, rough_var=0.10,
                        noise_scale=80.0)

    height, base, mouth = 0.20, 0.085, 0.115
    bm = bmesh.new()
    rings = [_ring(z, rx=base + (mouth - base) * (z / height), n=20)
             for z in (0.0, height * 0.5, height * 0.92, height)]
    _loft(bm, rings, cap_start=True, cap_end=False, mat=0)
    # A rolled lip, so the rim is not a zero-thickness edge.
    _loft(bm, [_ring(height, rx=mouth, n=20),
               _ring(height - 0.012, rx=mouth * 0.90, n=20)],
          cap_start=False, cap_end=True, mat=0)
    # Handle: a thin arc from rim to rim.
    arc = [Vector((math.cos(a) * mouth * 0.98, 0.0,
                   height + math.sin(a) * mouth * 0.55))
           for a in [math.radians(d) for d in range(0, 181, 20)]]
    _tube(bm, arc, [0.006] * len(arc), n=6, mat=0, up=Vector((0.0, 1.0, 0.0)))

    _spin(bm, rng)

    ob = _obj_from_bm(f'bucket{seed}', bm, [m_body])
    _finish(ob, bevel_width=0.004, smooth_angle=52.0)
    ob.rotation_mode = 'XYZ'
    ob.scale = (scale, scale, scale)
    ob['ph_kind'] = 'bucket'
    return ob


def make_parasol(seed=0, scale=1.0):
    """A beach parasol, planted at a lean.

    The lean is not decoration. A vertical pole with a symmetric disc on top
    is the most obviously procedural shape it is possible to put in a frame;
    tilting it four to eight degrees costs one line and is the difference
    between "placed by a person" and "instanced by a loop".
    """
    rng = Rng(seed * 7919 + 151)
    hue = rng.pick([(0.60, 0.14, 0.11), (0.12, 0.28, 0.55), (0.70, 0.52, 0.10)])
    m_canopy = principled(f'parasol{seed}', hue, rough=0.62, rough_var=0.12,
                          noise_scale=30.0, sheen=0.30)
    m_pole = principled(f'parasol_pole{seed}', (0.085, 0.070, 0.048),
                        rough=0.55, rough_var=0.12, noise_scale=60.0)

    top, span = 1.95, 0.92
    bm = bmesh.new()
    _tube(bm, [Vector((0, 0, -0.06)), Vector((0, 0, top))],
          [0.020, 0.016], n=8, mat=1)
    # Scalloped canopy: eight lobes, domed. A smooth cone reads as a lampshade.
    _loft(bm, [_ring(top, rx=0.028, n=24),
               _ring(top - 0.14, rx=span * 0.62, n=24, lobes=_scallop(8, 0.05)),
               _ring(top - 0.30, rx=span, n=24, lobes=_scallop(8, 0.07))],
          cap_start=True, cap_end=False, mat=0)
    _spin(bm, rng)

    ob = _obj_from_bm(f'parasol{seed}', bm, [m_canopy, m_pole])
    _finish(ob, bevel_width=0.004, smooth_angle=46.0)
    # The lean the docstring is about. Through `_lean` so the direction is
    # seeded too: written to X alone it would compose with the scene file's
    # `facing`, and a row of parasols all authored at rot 0 would lean as one.
    _lean(ob, rng, 4.0, 8.0)
    ob.scale = (scale, scale, scale)
    ob['ph_kind'] = 'parasol'
    return ob


# ---------------------------------------------------------------------------
# Generic primitives, and the named types built on them
#
# Measured over three screenplays: of the 83 objects the prose asks for, 79.5%
# read as a box, a cylinder or a sphere plus a colour. Split by the part they
# play it is 87.3% of SET DRESSING and only 14.3% of HERO props -- the ones the
# script names, touches or shoots in close-up. So this layer is here to dress a
# set cheaply, not to save anyone the work of modelling a hero prop: a rifle
# still has to be a rifle. Porting the browser's twenty-seven missing types one
# at a time is ~950 lines; these are ~30 each.
#
# `make_slab`, `make_rod` and `make_orb` are the bare shapes, sized and tinted
# from the scene file per the `options` contract. Everything after them is a
# NAMED type, because a name carries what a shape cannot -- the validator has
# to know that a mug is 8 cm across and must never be the subject of a
# close-up, and no amount of `size: [0.08, 0.08, 0.08]` tells it that.
#
# Named types therefore take `colour` but deliberately NOT `size`: their size
# is the metadata, taken from props.js's PROPS table verbatim so the preview
# and the film agree about how big a table is. Blocking solved against a 1.4 m
# table in the browser is wrong in the film if the film's table is 1.2 m. A
# scene that genuinely wants a three-metre crate wants `make_slab`.
# ---------------------------------------------------------------------------


def _dims(size, default):
    """Scene-file ``size`` -> Blender (x, y, z) extents.

    The contract's ``size`` is three.js ``[width, height, depth]`` in metres,
    which is the order props.js publishes and therefore the only order a scene
    author ever sees. Blender is Z-up, so height is the *last* component here
    and depth is the second. Getting it wrong builds a table 80 cm wide and
    1.4 m tall, which validates perfectly and renders as a lectern.
    """
    w, h, d = default if size is None else size
    return (abs(float(w)), abs(float(d)), abs(float(h)))


def _dressing_material(name, colour, default, rng, rough=0.62, scale=9.0,
                       shade=0.62, texture='NOISE', bump=0.0, sheen=0.0,
                       distortion=0.0):
    """The house material for dressing: one colour, blotched with a darker self.

    A generic primitive is the asset most at risk of reading as programmer art,
    because it has no silhouette to hide behind — a box with one flat albedo is
    *literally* the default cube. The second tone is the first scaled down and
    nudged in hue rather than a second palette entry, because that is what wear
    does: it darkens a surface unevenly, it does not repaint it.
    """
    base = hex_rgb(colour, default)
    worn = jitter_colour([c * shade for c in base], rng, hue=0.03, sat=0.25,
                         val=0.20)
    return _mix_colour_material(name, base, worn, scale, rough, bump=bump,
                                texture=texture, sheen=sheen,
                                distortion=distortion)


def _lean(ob, rng, lo=3.0, hi=8.0):
    """Take an object off true vertical by a seeded few degrees.

    A perfect vertical is the loudest CG tell after a razor edge: nothing a
    person put down is plumb. Seeded from the prop's id, so the crate leans the
    same way in every frame of the film rather than flickering.

    Only X and Y are written. ``render_scene.place`` owns the Z rotation — it
    is the scene file's ``facing`` — so a yaw authored here would be silently
    overwritten, and any yaw jitter that wants to exist has to live in the mesh
    instead. The tilt survives because ``register_prop`` records it and a
    set-down restores it.

    The rotation is about the object's origin, which sits at the centre of its
    base, so a leaning object digs one edge in rather than hovering on the
    other. That is why the angle is small for anything with a wide footprint:
    at 8 degrees a 0.54 m crate buries a corner 38 mm.
    """
    ang = math.radians(rng.range(lo, hi))
    axis = rng.range(0.0, TAU)
    ob.rotation_mode = 'XYZ'
    ob.rotation_euler[0] = math.cos(axis) * ang
    ob.rotation_euler[1] = math.sin(axis) * ang
    return ob


def _shaft(bm, base, size, mat=0, n=16, taper=1.0, bulge=0.0, lobes=None,
           lobe_peak=1.0, cap_start=True, cap_end=True, steps=4):
    """A vertical body of revolution inscribed *exactly* in a box.

    ``taper`` is the top radius as a fraction of the bottom, ``bulge`` swells
    the waist. Both are normalised against the widest ring so the result fills
    ``size`` and no more: a barrel is a cylinder with a 19% swell, and without
    the normalisation asking for a 0.60 m barrel builds a 0.71 m one — an error
    that never crashes and only shows up as an actor standing too far away from
    something.
    """
    rx, ry, h = size[0] * 0.5, size[1] * 0.5, size[2]
    ks = [(1.0 - i / steps) + taper * (i / steps)
          + bulge * math.sin(math.pi * i / steps) for i in range(steps + 1)]
    peak = max(ks) * lobe_peak
    rings = [_ring(base[2] + (i / steps) * h, cx=base[0], cy=base[1],
                   rx=rx * k / peak, ry=ry * k / peak, n=n, lobes=lobes)
             for i, k in enumerate(ks)]
    return _loft(bm, rings, cap_start, cap_end, mat)


def _ellipsoid(bm, centre, size, mat=0, seed=0, subdiv=2, dent=0.12):
    """An ellipsoid inscribed in a box, dented rather than swelled.

    :func:`_blob` pushes its radius both ways, which is right for a canopy and
    wrong here, because this shape has to fit a measured bounding box. So the
    noise only ever removes material. Nothing is a perfect ellipsoid anyway — a
    cast doorknob has flats and a stone has hollows — and the hollows are the
    half worth keeping.

    Removing material shrinks the result, so it is rescaled onto the box
    afterwards. Without that a 0.24 m stone measures 0.227 m, because the noise
    never quite reaches zero anywhere on the surface — and the size table is
    the only thing the validator has to reason about a prop with.
    """
    r = Vector((size[0] * 0.5, size[1] * 0.5, size[2] * 0.5))
    res = bmesh.new()
    bmesh.ops.create_icosphere(res, subdivisions=subdiv, radius=1.0)
    off = Vector((seed * 3.7, seed * 1.3, seed * 2.1))
    dented = []
    peak = [1e-9, 1e-9, 1e-9]
    for v in res.verts:
        d = v.co.normalized()
        k = _fbm((d * 2.6) + off, seed=seed, octaves=2)
        p = Vector((d.x * r.x, d.y * r.y, d.z * r.z)) * (1.0 - dent * k)
        dented.append((v, p))
        for i in range(3):
            peak[i] = max(peak[i], abs(p[i]))
    for v, p in dented:
        v.co = Vector((p.x * r.x / peak[0], p.y * r.y / peak[1],
                       p.z * r.z / peak[2])) + Vector(centre)
    for f in res.faces:
        f.material_index = mat
    me = bpy.data.meshes.new('_tmp')
    res.to_mesh(me)
    res.free()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)


def make_slab(seed=0, scale=1.0, colour=None, size=None):
    """A flat rectangular mass: a board, a panel, a lid, a step, a headstone.

    The generic dressing shape, and the one it is most dangerous to be lazy
    about, because a box with one albedo and square corners *is* the default
    cube. Hence two tones, a seeded lean, and a bevel scaled to the thinnest
    dimension — the default 6 mm bevel on a 10 mm panel eats the panel and
    leaves a lozenge.
    """
    rng = Rng(seed * 7919 + 211)
    dims = _dims(size, (0.30, 0.20, 0.04))
    mat = _dressing_material(f'slab{seed}', colour, (0.055, 0.049, 0.040), rng,
                             rough=0.58, scale=7.0, bump=0.16)
    bm = bmesh.new()
    _box(bm, (0.0, 0.0, dims[2] * 0.5), dims, mat=0)
    ob = _obj_from_bm(f'slab{seed}', bm, [mat])
    _finish(ob, bevel_width=min(0.006, 0.22 * min(dims)))
    _lean(ob, rng, 3.0, 6.0)
    ob.scale = (scale, scale, scale)
    ob['ph_grip'] = (0.0, 0.0, dims[2] * 0.5)
    ob['ph_kind'] = 'slab'
    return ob


def make_rod(seed=0, scale=1.0, colour=None, size=None):
    """An upright cylinder: a post, a pipe, a bollard, a rolled carpet.

    Seeded taper as well as seeded lean. A prism of exactly constant radius is
    a manufacturing achievement; everything else in the world is thicker at one
    end, and the two together are what stop a row of fence posts reading as one
    post instanced eight times.
    """
    rng = Rng(seed * 7919 + 223)
    dims = _dims(size, (0.12, 0.25, 0.12))
    mat = _dressing_material(f'rod{seed}', colour, (0.052, 0.044, 0.034), rng,
                             rough=0.55, scale=12.0, bump=0.12)
    bm = bmesh.new()
    # 20 sides, not 18: a ring only reaches its stated radius where it has a
    # vertex, and 20 puts one on each of the four cardinal axes, so the built
    # object measures the size it was asked for.
    _shaft(bm, (0.0, 0.0, 0.0), dims, mat=0, n=20,
           taper=rng.range(0.86, 1.0))
    ob = _obj_from_bm(f'rod{seed}', bm, [mat])
    _finish(ob, bevel_width=min(0.005, 0.22 * min(dims)), smooth_angle=46.0)
    _lean(ob, rng, 3.0, 8.0)
    ob.scale = (scale, scale, scale)
    # A stick is held down the shaft, not in the middle: a torch or a broom
    # balanced at its centre reads as a weightless prop.
    ob['ph_grip'] = (0.0, 0.0, dims[2] * 0.36)
    ob['ph_kind'] = 'rod'
    return ob


def make_orb(seed=0, scale=1.0, colour=None, size=None):
    """A rounded mass: a stone, a pot, a fruit, a buoy, a snowball.

    A sphere cannot be leaned — a rotation about any axis leaves it identical —
    so its asymmetry has to be in the mesh. That is what the dents are for, and
    why the noise field is offset per seed: two stones from the same builder
    have to be two stones. Sunk a fiftieth of its height into the floor for the
    same reason make_ball is: a sphere resting on a mathematical tangent point
    casts a contact shadow the size of a full stop, and reads as hovering.
    """
    rng = Rng(seed * 7919 + 227)
    dims = _dims(size, (0.24, 0.24, 0.24))
    mat = _dressing_material(f'orb{seed}', colour, (0.048, 0.046, 0.042), rng,
                             rough=0.52, scale=16.0, bump=0.22)
    bm = bmesh.new()
    _ellipsoid(bm, (0.0, 0.0, dims[2] * 0.48), dims, mat=0,
               seed=int(rng.range(1.0, 900.0)), subdiv=3, dent=0.12)
    ob = _obj_from_bm(f'orb{seed}', bm, [mat])
    _finish(ob, bevel=False, smooth_angle=180.0)
    ob.scale = (scale, scale, scale)
    ob['ph_grip'] = (0.0, 0.0, dims[2] * 0.48)
    ob['ph_kind'] = 'orb'
    return ob


def make_crate(seed=0, scale=1.0, colour=None):
    """A packing crate, 0.54 m cubed, battened and dumped at an angle.

    The battens are the whole read. A plain cube at twenty pixels is a cube;
    two bands of proud timber give it four horizontal highlights and a broken
    silhouette, which is what says "crate" before any detail resolves. Kept to
    2-5 degrees of lean rather than the usual 8 because the origin is at the
    centre of the base, so a big footprint tipped hard buries a corner.
    """
    rng = Rng(seed * 7919 + 307)
    m_wood = _dressing_material(f'crate{seed}', colour, hex_rgb('#6a4a28'), rng,
                                rough=0.72, scale=6.0, texture='WAVE',
                                distortion=1.4, bump=0.20)
    m_batten = _dressing_material(f'crate_batten{seed}', None,
                                  hex_rgb('#4a3018'), rng, rough=0.78,
                                  scale=11.0, bump=0.24)

    s, band, proud = 0.54, 0.06, 0.02
    body = s - proud * 2.0
    bm = bmesh.new()
    _box(bm, (0.0, 0.0, s * 0.5), (body, body, s), mat=0)
    # Two bands, low and high rather than symmetrically placed, and at a
    # seeded height: a crate nailed by a person is not a diagram, and two
    # crates side by side must not be the same crate twice.
    for z in (s * rng.range(0.15, 0.23), s * rng.range(0.77, 0.85)):
        for sign in (-1.0, 1.0):
            _box(bm, (0.0, sign * (s - proud) * 0.5, z), (s, proud, band), mat=1)
            _box(bm, (sign * (s - proud) * 0.5, 0.0, z), (proud, s, band), mat=1)

    ob = _obj_from_bm(f'crate{seed}', bm, [m_wood, m_batten])
    _finish(ob, bevel_width=0.004, bevel_angle=28.0, smooth_angle=30.0)
    _lean(ob, rng, 2.0, 5.0)
    ob.scale = (scale, scale, scale)
    ob['ph_kind'] = 'crate'
    return ob


def make_barrel(seed=0, scale=1.0, colour=None):
    """A coopered barrel: 0.60 m at the waist, 0.82 m tall, three iron hoops.

    Two cues do all the work and both are silhouette. The 19% swell at the
    waist is what separates a barrel from a bin — a straight cylinder with
    hoops reads as an oil drum. The staves are a 1% scallop, which sounds
    invisible and is not: it breaks the outline into sixteen facets that catch
    the key light one at a time as the camera moves.
    """
    rng = Rng(seed * 7919 + 311)
    m_wood = _dressing_material(f'barrel{seed}', colour, hex_rgb('#5a3f22'),
                                rng, rough=0.68, scale=5.0, texture='WAVE',
                                distortion=1.1, bump=0.18)
    m_iron = principled(f'barrel_hoop{seed}', hex_rgb('#4a4038'), rough=0.46,
                        metal=0.75, rough_var=0.18, noise_scale=70.0)

    dia, height, stave = 0.60, 0.82, 0.010
    # The hoops stand 2% proud, so the body is normalised down by the same
    # amount: the widest thing on the object has to be 0.60, not 0.612.
    hoop_proud = 1.02
    body = (dia / hoop_proud, dia / hoop_proud, height)
    # Browser profile: 0.31 at the waist over 0.26 at the ends, seeded either
    # side of it because a cooper's barrel is not a lathe part.
    bulge = rng.range(0.170, 0.215)
    bm = bmesh.new()
    _shaft(bm, (0.0, 0.0, 0.0), body, mat=0, n=32, bulge=bulge, steps=8,
           lobes=_scallop(16, stave), lobe_peak=1.0 + stave)
    for t in (rng.range(0.10, 0.15), 0.50, rng.range(0.85, 0.90)):
        k = (1.0 + bulge * math.sin(math.pi * t)) / (1.0 + bulge)
        r = body[0] * 0.5 * k * hoop_proud
        _shaft(bm, (0.0, 0.0, height * t - 0.014), (r * 2.0, r * 2.0, 0.028),
               mat=1, n=32)

    ob = _obj_from_bm(f'barrel{seed}', bm, [m_wood, m_iron])
    _finish(ob, bevel_width=0.003, smooth_angle=44.0)
    _lean(ob, rng, 2.0, 5.0)
    ob.scale = (scale, scale, scale)
    ob['ph_kind'] = 'barrel'
    return ob


def make_cup(seed=0, scale=1.0, colour=None):
    """A mug, 8 cm over the handle, origin at the base.

    Open at the top and lofted rather than blobbed, for make_bucket's reason:
    the dark ellipse of the mouth is the entire cue that says "container". The
    handle is the other one — a lidless tapered cylinder on a table is a plant
    pot until something sticks out of the side of it — and it is why the 8 cm
    in the size table is 8 cm *including the handle*, not the 6 cm body.
    """
    rng = Rng(seed * 7919 + 401)
    m_body = _dressing_material(f'cup{seed}', colour, hex_rgb('#d8d0c0'), rng,
                                rough=0.28, scale=40.0, shade=0.78)

    height, rim, thick = 0.078, 0.031, 0.0055
    base_r = rng.range(0.022, 0.026)     # how hard the potter pulled the wall
    # The handle's outer surface, not its centreline, is what has to land on
    # 0.08 across: the tube's own radius counts.
    reach = 0.080 - rim - thick
    hang, span = rng.range(0.52, 0.58), rng.range(0.26, 0.30)
    bm = bmesh.new()
    _shaft(bm, (0.0, 0.0, 0.0), (rim * 2.0, rim * 2.0, height), mat=0, n=20,
           taper=rim / base_r, cap_end=False)
    # A rolled lip, so the rim is not a zero-thickness edge (see make_bucket).
    _loft(bm, [_ring(height, rx=rim, n=20),
               _ring(height - 0.010, rx=rim * 0.88, n=20)],
          cap_start=False, cap_end=True, mat=0)
    arc = [Vector((rim * 0.92 + math.sin(a) * (reach - rim * 0.92), 0.0,
                   height * hang - math.cos(a) * height * span))
           for a in [math.radians(d) for d in range(0, 181, 30)]]
    _tube(bm, arc, [thick] * len(arc), n=8, mat=0, up=Vector((0.0, 1.0, 0.0)))

    ob = _obj_from_bm(f'cup{seed}', bm, [m_body])
    _finish(ob, bevel_width=0.002, smooth_angle=48.0)
    # Thrown, not moulded: 2-5 degrees, because a mug leaning 8 degrees on a
    # table reads as a mug about to go over.
    _lean(ob, rng, 2.0, 5.0)
    ob.scale = (scale, scale, scale)
    # The palm closes round the body, not the handle: at this size a hand
    # covers both, and gripping the handle would swing the mug off the wrist.
    ob['ph_grip'] = (0.0, 0.0, height * 0.55)
    ob['ph_kind'] = 'cup'
    return ob


def make_bottle(seed=0, scale=1.0, colour=None):
    """A 0.29 m bottle: body, shoulder, neck, and a label stuck on crooked.

    The label earns its place twice. It is the second tone this object would
    otherwise have to fake, and it is the only thing on a bottle that can be
    *wrong* — a paper rectangle 2-5 degrees off square around the body is the
    cheapest hand-made cue in the library.

    The glass is opaque. Transmission on a background bottle costs light paths
    for a result nobody resolves at MS; a dark saturated albedo at low
    roughness reads as green glass and renders for free.
    """
    rng = Rng(seed * 7919 + 419)
    m_glass = _dressing_material(f'bottle{seed}', colour, hex_rgb('#3a5a3a'),
                                 rng, rough=0.16, scale=30.0, shade=0.55)
    m_label = principled(f'bottle_label{seed}', hex_rgb('#d8cdb8'), rough=0.86,
                         rough_var=0.16, noise_scale=110.0, sheen=0.22)

    profile = [(0.000, 0.0400), (0.012, 0.0443), (0.130, 0.0443),
               (0.170, 0.0330), (0.200, 0.0170), (0.265, 0.0170),
               (0.278, 0.0200), (0.290, 0.0155)]
    bm = bmesh.new()
    _loft(bm, [_ring(z, rx=r, n=18) for z, r in profile], mat=0)
    tilt = math.tan(math.radians(rng.range(2.0, 5.0)))
    for z in ((0.045, 0.108),):
        lo, hi = z
        rings = [[Vector((p.x, p.y, p.z + p.x * tilt))
                  for p in _ring(edge, rx=0.0450, n=18)] for edge in (lo, hi)]
        _loft(bm, rings, cap_start=False, cap_end=False, mat=1)

    ob = _obj_from_bm(f'bottle{seed}', bm, [m_glass, m_label])
    _finish(ob, bevel_width=0.002, smooth_angle=44.0)
    _lean(ob, rng, 2.0, 5.0)
    ob.scale = (scale, scale, scale)
    # Carried by the neck, which is how a bottle is picked up and which lets it
    # hang below the hand instead of standing on the palm.
    ob['ph_grip'] = (0.0, 0.0, 0.225)
    ob['ph_kind'] = 'bottle'
    return ob


def make_table(seed=0, scale=1.0, colour=None):
    """A 1.4 x 0.8 m table, top surface at 0.80 m.

    The one asset here that must NOT lean: it stands on four legs and tipping
    it lifts two of them off the floor, which is a worse artefact than the
    plumbness it fixes. Its share of the anti-symmetry rule is paid in the mesh
    instead — every leg is a different thickness and sits at a different inset,
    and the top is a few millimetres off centre, the way a top that was fitted
    to a frame by hand is.

    The apron under the top is not decoration either. Without it the legs meet
    the underside at a bare right angle and the whole thing reads as four
    cylinders holding up a plank, which at MS is exactly what it is.
    """
    rng = Rng(seed * 7919 + 503)
    # shade 0.80 rather than the library default 0.62: a table top is the one
    # large flat plane in an interior, and the key light rakes across it. At
    # full grain contrast the planks read as the stripes of a deckchair.
    m_wood = _dressing_material(f'table{seed}', colour, hex_rgb('#4a2f1c'), rng,
                                rough=0.44, scale=4.0, texture='WAVE',
                                distortion=1.6, bump=0.10, shade=0.80)
    m_under = _dressing_material(f'table_under{seed}', colour,
                                 hex_rgb('#4a2f1c'), rng, rough=0.62,
                                 scale=7.0, shade=0.48, bump=0.14)

    w, d, h, thick = 1.40, 0.80, 0.80, 0.055
    bm = bmesh.new()
    _box(bm, (rng.range(-0.004, 0.004), rng.range(-0.004, 0.004), h - thick * 0.5),
         (w, d, thick), mat=0)
    _box(bm, (0.0, 0.0, h - thick - 0.045), (w - 0.14, d - 0.14, 0.09), mat=1)
    for sx in (-1.0, 1.0):
        for sy in (-1.0, 1.0):
            leg = rng.range(0.066, 0.076)
            inset = rng.range(0.085, 0.100)
            _box(bm, (sx * (w * 0.5 - inset), sy * (d * 0.5 - inset),
                      (h - thick - 0.01) * 0.5),
                 (leg, leg, h - thick - 0.01), mat=0)

    ob = _obj_from_bm(f'table{seed}', bm, [m_wood, m_under])
    _finish(ob, bevel_width=0.005, bevel_angle=28.0, smooth_angle=30.0)
    ob.scale = (scale, scale, scale)
    ob['ph_kind'] = 'table'
    return ob


def make_stool(seed=0, scale=1.0, colour=None):
    """A three-legged stool, 0.40 m across, seat at 0.48 m.

    Three legs rather than four, and splayed: it is the shape that reads as a
    stool at any distance, and unlike a four-legged one it stands flat on a
    displaced ground mesh without rocking. The splay angles are jittered
    independently, so no two of the three make the same triangle.
    """
    rng = Rng(seed * 7919 + 509)
    # Blotched, not banded. The WAVE grain the flat-panel assets use reads as a
    # machined thread when it wraps a 20 mm turned leg or a seat rim, and a
    # stool that looks threaded looks like plumbing.
    m_wood = _dressing_material(f'stool{seed}', colour, hex_rgb('#5a3a20'), rng,
                                rough=0.52, scale=11.0, shade=0.74, bump=0.14)

    dia, h, seat = 0.40, 0.48, 0.048
    bm = bmesh.new()
    _shaft(bm, (0.0, 0.0, h - seat), (dia, dia, seat), mat=0, n=24, taper=0.95)
    for i in range(3):
        a = TAU * i / 3.0 + rng.range(-0.12, 0.12)
        foot = rng.range(0.160, 0.178)
        top = rng.range(0.115, 0.135)
        # A splayed leg's end cap is perpendicular to the leg, not to the
        # floor, so the foot starts 2 mm up: run it to z = 0 and the downhill
        # half of the cap hangs through the floor. The top runs 6 mm *into*
        # the seat, because a leg that merely touches it leaves a shadow gap.
        _tube(bm, [Vector((math.cos(a) * foot, math.sin(a) * foot, 0.002)),
                   Vector((math.cos(a) * top, math.sin(a) * top,
                           h - seat + 0.006))],
              [rng.range(0.019, 0.023), 0.018], n=8, mat=0)

    ob = _obj_from_bm(f'stool{seed}', bm, [m_wood])
    _finish(ob, bevel_width=0.004, smooth_angle=44.0)
    ob.scale = (scale, scale, scale)
    ob['ph_kind'] = 'stool'
    return ob


def make_chair(seed=0, scale=1.0, colour=None):
    """A ladder-back chair, 1.00 m to the top rail, seat at 0.46 m.

    The back is the silhouette and the rake is the anti-symmetry: a real chair
    leans its back 6-10 degrees off vertical, so this one does too, and that
    satisfies the never-plumb rule without tipping the chair off its own legs.
    Three rails with a gap between them beat a solid panel — the gaps let the
    background through, which is what makes a chair readable in front of a
    bright wall.

    Faces +Y, so an actor placed at the seat and facing +Y is sitting in it
    rather than astride the back.
    """
    rng = Rng(seed * 7919 + 521)
    # Blotched rather than banded, for make_stool's reason: every part of a
    # chair is 45 mm stock, and a plank grain wrapped round it reads as thread.
    m_wood = _dressing_material(f'chair{seed}', colour, hex_rgb('#5a3a20'), rng,
                                rough=0.50, scale=11.0, shade=0.74, bump=0.14)
    m_seat = _dressing_material(f'chair_seat{seed}', None, hex_rgb('#7a4a3a'),
                                rng, rough=0.82, scale=22.0, bump=0.30,
                                sheen=0.28)

    seat_z, top_z, back_y, stile = 0.46, 1.00, -0.175, 0.045
    # 5-8 degrees, not the library's usual 3-8: at 10 the top rail swings the
    # chair past the 0.50 m depth the size table promises the placement solver.
    rake = math.radians(rng.range(5.0, 8.0))
    ca, sa = math.cos(rake), math.sin(rake)

    def raked(dz, dy=0.0):
        """Position on the raked back, measured from the seat's back edge."""
        return (back_y + dy * ca - dz * sa, seat_z + dy * sa + dz * ca)

    bm = bmesh.new()
    _box(bm, (0.0, 0.0, seat_z - 0.025), (0.46, 0.44, 0.05), mat=1)
    for sx in (-1.0, 1.0):
        for sy in (-1.0, 1.0):
            leg = rng.range(0.040, 0.048)
            _box(bm, (sx * rng.range(0.168, 0.186), sy * rng.range(0.168, 0.186),
                      (seat_z - 0.05) * 0.5),
                 (leg, leg, seat_z - 0.05), mat=0)
    # Stiles run to the top rail; the rails hang between them, unevenly spaced.
    # The reach is shortened by the raked stile's own top corner, which stands
    # proud of the centre of its end face and is the real top of the chair.
    reach = (top_z - seat_z - stile * 0.5 * sa) / ca
    for sx in (-1.0, 1.0):
        y, z = raked(reach * 0.5)
        _box(bm, (sx * 0.200, y, z), (stile, stile, reach), mat=0,
             rot=Euler((rake, 0.0, 0.0)))
    for frac in (0.30, 0.58, 0.88):
        y, z = raked(reach * (frac + rng.range(-0.03, 0.03)))
        _box(bm, (0.0, y, z), (0.355, 0.030, 0.055), mat=0,
             rot=Euler((rake, 0.0, 0.0)))

    ob = _obj_from_bm(f'chair{seed}', bm, [m_wood, m_seat])
    _finish(ob, bevel_width=0.004, bevel_angle=28.0, smooth_angle=32.0)
    ob.scale = (scale, scale, scale)
    ob['ph_kind'] = 'chair'
    return ob


def make_rug(seed=0, scale=1.0, colour=None):
    """A 2.6 x 1.8 m rug: one rippled sheet, three colour zones.

    Built as a grid rather than a slab because a rug is the one prop that is
    genuinely two-dimensional, and a mathematically flat 2.6 m rectangle lying
    on a displaced ground mesh is the flattest thing in the frame. A few
    millimetres of weave ripple plus corners that curl up on a fourth power
    gives it a broken edge and somewhere for the grazing key light to catch —
    which is the whole reason a rug is in a shot at all.

    The border, band and medallion are per-face material zones, so it is one
    mesh and one draw. The grid lines are placed *on* the zone boundaries
    rather than spread evenly, because a boundary that falls mid-cell renders
    as a staircase.
    """
    rng = Rng(seed * 7919 + 601)
    m_field = _dressing_material(f'rug{seed}', colour, hex_rgb('#6a3038'), rng,
                                 rough=0.88, scale=26.0, bump=0.34, sheen=0.30)
    m_trim = _dressing_material(f'rug_trim{seed}', None, hex_rgb('#c9a24a'),
                                rng, rough=0.86, scale=26.0, bump=0.34,
                                sheen=0.30)

    hw, hd = 1.30, 0.90
    # props.js buildRug insets its border a fixed 0.14 m and the band inside it
    # a further 0.09, the same all the way round. Insetting by a *fraction*
    # instead would make the border half as wide on the short side as on the
    # long, which no woven rug is.
    edge, band = 0.14, 0.23
    med_x, med_y = hw * 0.22, hd * 0.22

    def axis(half, med):
        cuts = {half - edge, half - band, med,
                -(half - edge), -(half - band), -med}
        cuts |= {-half + 2.0 * half * i / 22.0 for i in range(23)}
        return sorted({round(c, 5) for c in cuts})

    xs, ys = axis(hw, med_x), axis(hd, med_y)
    bm = bmesh.new()
    grid = []
    for x in xs:
        col = []
        for y in ys:
            t = max(abs(x) / hw, abs(y) / hd)
            # Weave ripple plus a corner curl on a fourth power, and the two
            # together stay inside the 10 mm the size table calls a rug: a
            # bigger curl looks like a rug being blown off the floor.
            z = (_fbm((x * 1.6, y * 1.6, 0.0), seed=seed, octaves=2) - 0.5) * 0.004
            col.append(bm.verts.new((x, y, z + 0.0055 * t ** 4)))
        grid.append(col)
    for i in range(len(xs) - 1):
        for j in range(len(ys) - 1):
            f = bm.faces.new((grid[i][j], grid[i + 1][j],
                              grid[i + 1][j + 1], grid[i][j + 1]))
            cx = (xs[i] + xs[i + 1]) * 0.5
            cy = (ys[j] + ys[j + 1]) * 0.5
            inset = min(hw - abs(cx), hd - abs(cy))
            f.material_index = 1 if (edge <= inset < band
                                     or (abs(cx) < med_x
                                         and abs(cy) < med_y)) else 0

    ob = _obj_from_bm(f'rug{seed}', bm, [m_field, m_trim])
    # No bevel: a sheet has no convex edge to round, and the modifier would
    # only pinch the boundary loop.
    _finish(ob, bevel=False, smooth_angle=60.0)
    ob.scale = (scale, scale, scale)
    ob['ph_kind'] = 'rug'
    return ob


def make_portrait(seed=0, scale=1.0, colour=None):
    """A framed portrait, 0.62 x 0.82 m, hung 2-5 degrees crooked.

    Crooked about the wall normal, not tipped off it, and 2-5 rather than the
    usual 3-8: measured against the frame edge, a picture at 8 degrees reads as
    a gag about an earthquake. Two or three is the angle that reads as a house
    somebody lives in.

    The canvas is a mottled two-tone rather than a painted figure. At the size
    a portrait occupies in anything wider than a CU it is a dark rectangle with
    a warm patch in it, and modelling more than that is detail nobody resolves.
    """
    rng = Rng(seed * 7919 + 607)
    m_frame = _dressing_material(f'portrait_frame{seed}', colour,
                                 hex_rgb('#8a6a2a'), rng, rough=0.38,
                                 scale=18.0, shade=0.55, bump=0.20)
    m_canvas = _mix_colour_material(f'portrait_canvas{seed}',
                                    hex_rgb('#3a2f24'), hex_rgb('#171009'),
                                    3.4, 0.86, bump=0.10, distortion=1.2)

    w, h, deep = 0.62, 0.82, 0.06
    rail = rng.range(0.046, 0.064)      # how heavy a frame this house bought
    bm = bmesh.new()
    for sx in (-1.0, 1.0):
        _box(bm, (sx * (w - rail) * 0.5, 0.0, h * 0.5), (rail, deep, h), mat=0)
        _box(bm, (0.0, 0.0, h * 0.5 + sx * (h - rail) * 0.5),
             (w - rail * 2.0, deep, rail), mat=0)
    _box(bm, (0.0, -0.012, h * 0.5), (w - rail * 2.0, 0.012, h - rail * 2.0),
         mat=1)

    ob = _obj_from_bm(f'portrait{seed}', bm, [m_frame, m_canvas])
    _finish(ob, bevel_width=0.003, bevel_angle=28.0, smooth_angle=30.0)
    ob.rotation_mode = 'XYZ'
    ob.rotation_euler[1] = math.radians(rng.range(2.0, 5.0)) * rng.sign()
    ob.scale = (scale, scale, scale)
    ob['ph_kind'] = 'portrait'
    return ob


def make_window(seed=0, scale=1.0, colour=None):
    """A casement, 1.24 x 1.58 m, pane facing +Y.

    The glass emits. A window is not dressing that happens to be near a light,
    it *is* the light in most interiors, and an unlit dark rectangle in a wall
    reads as a hole. Strength 1.15-1.65 rather than emissive()'s default 6: at
    a square metre and a half this is a soft source lighting a room, and six
    would blow the wall around it out before the exposure could catch up.

    Built into a wall, so no lean — its share of the anti-symmetry rule is the
    mullion and the transom, off centre by a seeded few centimetres.
    """
    rng = Rng(seed * 7919 + 613)
    m_frame = _dressing_material(f'window{seed}', colour, hex_rgb('#3a2412'),
                                 rng, rough=0.60, scale=8.0, texture='WAVE',
                                 distortion=1.2, bump=0.16)
    # Four panes, two materials. Old glass is not one flat sheet of sky: each
    # pane was floated separately and catches the light a shade differently,
    # and alternating two tones is what stops the glazing reading as a decal.
    glass = [emissive(f'window_glass{seed}_{i}',
                      jitter_colour(hex_rgb('#16243a'), rng, hue=0.02,
                                    sat=0.20, val=0.26),
                      strength=rng.range(1.15, 1.65), base=hex_rgb('#0d1830'))
             for i in range(2)]

    w, h, deep, rail = 1.24, 1.58, 0.12, 0.09
    bm = bmesh.new()
    for sx in (-1.0, 1.0):
        _box(bm, (sx * (w - rail) * 0.5, 0.0, h * 0.5), (rail, deep, h), mat=0)
        _box(bm, (0.0, 0.0, h * 0.5 + sx * (h - rail) * 0.5),
             (w - rail * 2.0, deep, rail), mat=0)
    glass_w, glass_h = w - rail * 2.0, h - rail * 2.0
    mull_x = rng.range(-0.03, 0.03)
    # The transom sits above the middle, where a glazier puts it so the small
    # pane is the one at the top, plus a little jitter on that.
    tran_z = h * 0.5 + glass_h * rng.range(0.04, 0.10)
    for i, (x0, x1) in enumerate(((-glass_w * 0.5, mull_x),
                                  (mull_x, glass_w * 0.5))):
        for j, (z0, z1) in enumerate(((h * 0.5 - glass_h * 0.5, tran_z),
                                      (tran_z, h * 0.5 + glass_h * 0.5))):
            _box(bm, ((x0 + x1) * 0.5, -0.020, (z0 + z1) * 0.5),
                 (abs(x1 - x0), 0.012, abs(z1 - z0)), mat=1 + (i + j) % 2)
    # Mullion and transom, both proud of the glass so they cast on it.
    _box(bm, (mull_x, -0.005, h * 0.5), (0.045, 0.055, glass_h), mat=0)
    _box(bm, (0.0, -0.005, tran_z), (glass_w, 0.055, 0.045), mat=0)
    # Sill: the one part that stands proud of the wall, and the reason a window
    # has a shadow under it at all.
    _box(bm, (0.0, 0.010, rail * 0.32), (w, deep + 0.02, 0.05), mat=0)

    ob = _obj_from_bm(f'window{seed}', bm, [m_frame, *glass])
    _finish(ob, bevel_width=0.004, bevel_angle=28.0, smooth_angle=30.0)
    ob.scale = (scale, scale, scale)
    ob['ph_kind'] = 'window'
    return ob


def make_door(seed=0, scale=1.0, colour=None):
    """A door in its casing, 1.06 x 2.22 m, leaf standing 3-6 degrees ajar.

    The ajar angle is where this asset spends its anti-symmetry budget, and it
    is the best value in the file: a leaf flush in its frame is a flat panel,
    while four degrees open puts a wedge of shadow down the hinge side and a
    hard vertical highlight down the other. It also says the room continues,
    which is most of what a door is for dramatically.

    It costs the declared depth — an open leaf swings out past the 0.12 m
    casing. props.js's size is a placement footprint rather than a bounding
    box, and the browser's own door already exceeds it by its knob.
    """
    rng = Rng(seed * 7919 + 617)
    # Distortion 0.7, well below the 1.4-1.6 the crate and the table run at:
    # the WAVE distortion is what breaks a plank edge up, and on 2 m of door it
    # multiplies into twenty fine specular ribs that read as corrugated iron.
    m_leaf = _dressing_material(f'door{seed}', colour, hex_rgb('#3a2412'), rng,
                                rough=0.52, scale=4.0, texture='WAVE',
                                distortion=0.7, bump=0.12, shade=0.78)
    m_case = _dressing_material(f'door_case{seed}', None, hex_rgb('#2b1a0c'),
                                rng, rough=0.62, scale=9.0, bump=0.18)
    m_brass = principled(f'door_knob{seed}', hex_rgb('#9a7a3a'), rough=0.28,
                         metal=0.80, rough_var=0.14, noise_scale=90.0)

    w, h, deep, jamb = 1.06, 2.22, 0.12, 0.08
    bm = bmesh.new()
    for sx in (-1.0, 1.0):
        _box(bm, (sx * (w - jamb) * 0.5, 0.0, h * 0.5), (jamb, deep, h), mat=1)
    _box(bm, (0.0, 0.0, h - jamb * 0.5), (w - jamb * 2.0, deep, jamb), mat=1)

    ajar = math.radians(rng.range(3.0, 6.0))
    hinge = -(w * 0.5 - jamb)
    # The leaf meets the head casing with no gap. A real door has a 4 mm
    # clearance there and it does not matter in a real doorway; standing free
    # in a set it is a slot of open sky above the door, and a rendered strip of
    # bright sky reads as a hole in the model.
    leaf_w, leaf_h, leaf_t = 0.88, h - jamb, 0.05
    rot = Euler((0.0, 0.0, -ajar))

    def swung(along, up, out=0.0):
        """A point on the leaf, `along` metres from the hinge, once it is open.

        `out` is toward +Y, the face the asset presents to camera — so the
        panels and the knob are on the side a shot can see, and the leaf itself
        opens away into the next room.
        """
        return (hinge + along * math.cos(ajar) + out * math.sin(ajar),
                -along * math.sin(ajar) + out * math.cos(ajar), up)

    _box(bm, swung(leaf_w * 0.5, leaf_h * 0.5), (leaf_w, leaf_t, leaf_h),
         mat=0, rot=rot)
    # Two panel mouldings, standing 10 mm proud of the leaf so they throw their
    # own shadow line: a flat slab is a board, a panelled one is a door.
    for z, ph in ((leaf_h * 0.70, 0.66), (leaf_h * 0.28, 0.54)):
        _box(bm, swung(leaf_w * 0.5, z, leaf_t * 0.5 + 0.005),
             (0.42, 0.020, ph), mat=1, rot=rot)
    x, y, z = swung(leaf_w - 0.09, 1.03, leaf_t * 0.5 + 0.02)
    _ellipsoid(bm, (x, y, z), (0.070, 0.070, 0.062), mat=2, seed=seed,
               subdiv=2, dent=0.05)

    ob = _obj_from_bm(f'door{seed}', bm, [m_leaf, m_case, m_brass])
    _finish(ob, bevel_width=0.004, bevel_angle=28.0, smooth_angle=32.0)
    ob.scale = (scale, scale, scale)
    ob['ph_kind'] = 'door'
    return ob


def make_bookshelf(seed=0, scale=1.0, colour=None):
    """A 1.00 x 1.95 m bookcase, five shelves, filled by the seed.

    The books are the asset. An empty carcass is six boxes and reads as a
    shelving unit in a warehouse; a hundred thin slabs of jittered width,
    height and colour give it a broken, high-frequency face that says "someone
    lives here" at any shot size, and they cost nothing because each one is
    eight vertices.

    One book in sixteen leans and one shelf run in sixteen has a gap, both from
    the seed. A perfectly packed shelf reads as a texture rather than as
    objects, which is the same failure as a perfectly plumb crate.
    """
    rng = Rng(seed * 7919 + 619)
    m_wood = _dressing_material(f'shelf{seed}', colour, hex_rgb('#3f2a18'), rng,
                                rough=0.56, scale=5.0, texture='WAVE',
                                distortion=1.4, bump=0.14)
    m_back = _dressing_material(f'shelf_back{seed}', colour, hex_rgb('#3f2a18'),
                                rng, rough=0.74, scale=9.0, shade=0.45,
                                bump=0.20)
    palette = ['#7a2f28', '#2f4a6a', '#4a5a34', '#6a5424', '#3f2f4a',
               '#7a5a3a', '#28404a']
    books = [_dressing_material(f'book{seed}_{i}', None, hex_rgb(c), rng,
                                rough=0.74, scale=30.0, bump=0.20, sheen=0.16)
             for i, c in enumerate(palette)]

    w, d, h = 1.00, 0.32, 1.95
    side, shelf_t = 0.05, 0.035
    bm = bmesh.new()
    for sx in (-1.0, 1.0):
        _box(bm, (sx * (w - side) * 0.5, 0.0, (h - 0.05) * 0.5),
             (side, d - 0.02, h - 0.05), mat=0)
    _box(bm, (0.0, -(d - 0.03) * 0.5, (h - 0.05) * 0.5), (w, 0.020, h - 0.05),
         mat=1)
    _box(bm, (0.0, 0.0, h - 0.025), (w, d, 0.05), mat=0)          # cornice

    inner = w - side * 2.0
    for s in range(5):
        z = 0.09 + s * 0.37
        _box(bm, (0.0, 0.0, z), (inner, d - 0.04, shelf_t), mat=0)
        x = -inner * 0.5 + 0.012
        while x < inner * 0.5 - 0.06:
            bw = rng.range(0.022, 0.052)
            if rng.next() < 0.0625:
                x += bw * rng.range(1.5, 3.0)       # a gap where one was taken
                continue
            bh = rng.range(0.20, 0.29)
            bd = rng.range(0.19, 0.25)
            lean = math.radians(rng.range(4.0, 9.0)) * rng.sign() \
                if rng.next() < 0.0625 else 0.0
            _box(bm, (x + bw * 0.5, -(d - 0.03) * 0.5 + bd * 0.5 + 0.03,
                      z + shelf_t * 0.5 + bh * 0.5), (bw, bd, bh),
                 mat=2 + int(rng.range(0.0, len(books))) % len(books),
                 rot=Euler((0.0, lean, 0.0)))
            x += bw + 0.004

    ob = _obj_from_bm(f'bookshelf{seed}', bm, [m_wood, m_back, *books])
    _finish(ob, bevel_width=0.0025, bevel_angle=28.0, smooth_angle=30.0)
    ob.scale = (scale, scale, scale)
    ob['ph_kind'] = 'bookshelf'
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

    The ``L`` bones sit at NEGATIVE x. The figure faces +Y with +Z up, so its
    own left is toward -X, and :func:`_three_euler_to_blender` maps the pose
    library's +X (three.js's actor-left) onto exactly that. Naming the +X side
    'L' instead — which this table did — leaves the rotations mirrored against
    the bones, so every abduction in the library adducts: measured on
    ``joyful``, the left hand travelled from the shoulder at x +0.17 to x -0.49,
    i.e. through the chest, the neck and the opposite arm.
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

        'clavL':     ((-h * 0.017, 0, h * 0.812), (-h * 0.088 * sh, 0, shoulder_z)),
        'upperArmL': ((-h * 0.096 * sh, 0, shoulder_z),
                      (-h * 0.096 * sh, 0, shoulder_z - h * 0.183 * limb)),
        'foreArmL':  ((-h * 0.096 * sh, 0, shoulder_z - h * 0.183 * limb),
                      (-h * 0.096 * sh, 0, shoulder_z - h * 0.320 * limb)),
        'handL':     ((-h * 0.096 * sh, 0, shoulder_z - h * 0.320 * limb),
                      (-h * 0.096 * sh, 0, shoulder_z - h * 0.415 * limb)),

        'clavR':     ((h * 0.017, 0, h * 0.812), (h * 0.088 * sh, 0, shoulder_z)),
        'upperArmR': ((h * 0.096 * sh, 0, shoulder_z),
                      (h * 0.096 * sh, 0, shoulder_z - h * 0.183 * limb)),
        'foreArmR':  ((h * 0.096 * sh, 0, shoulder_z - h * 0.183 * limb),
                      (h * 0.096 * sh, 0, shoulder_z - h * 0.320 * limb)),
        'handR':     ((h * 0.096 * sh, 0, shoulder_z - h * 0.320 * limb),
                      (h * 0.096 * sh, 0, shoulder_z - h * 0.415 * limb)),

        'thighL':    ((-h * 0.047 * hp, 0, hip_z * 0.96), (-h * 0.047 * hp, 0, h * 0.278)),
        'shinL':     ((-h * 0.047 * hp, 0, h * 0.278), (-h * 0.048 * hp, 0, h * 0.052)),
        'footL':     ((-h * 0.048 * hp, 0, h * 0.052), (-h * 0.048 * hp, h * 0.075, h * 0.012)),
        'toeL':      ((-h * 0.048 * hp, h * 0.075, h * 0.012),
                      (-h * 0.048 * hp, h * 0.135, h * 0.012)),

        'thighR':    ((h * 0.047 * hp, 0, hip_z * 0.96), (h * 0.047 * hp, 0, h * 0.278)),
        'shinR':     ((h * 0.047 * hp, 0, h * 0.278), (h * 0.048 * hp, 0, h * 0.052)),
        'footR':     ((h * 0.048 * hp, 0, h * 0.052), (h * 0.048 * hp, h * 0.075, h * 0.012)),
        'toeR':      ((h * 0.048 * hp, h * 0.075, h * 0.012),
                      (h * 0.048 * hp, h * 0.135, h * 0.012)),
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
    # 'L' builds at -x, matching _skeleton: the figure faces +Y, so its left
    # is -X, and the weighting below matches mesh to bone by proximity.
    for side, s in (('L', -1), ('R', 1)):
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
    for side, s in (('L', -1), ('R', 1)):
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
    'idleAlt': {
        'upperArmL': (-6, 0, 9), 'foreArmL': (-22, 0, 5),
        'upperArmR': (-3, 0, -5), 'foreArmR': (-10, 0, -2),
        'spine': (1, 3, 0), 'chest': (-1, -2, 0), 'neck': (1, -3, 0),
        'hips': (0, 2, 0),
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
    'talkBoth': {
        'upperArmL': (-20, 0, 20), 'foreArmL': (-66, 0, 12),
        'upperArmR': (-20, 0, -20), 'foreArmR': (-66, 0, -12),
        'spine': (-2, 0, 0), 'chest': (3, 0, 0), 'neck': (-2, 0, 0),
    },
    'sing': {
        'upperArmL': (-14, 0, 28), 'foreArmL': (-30, 0, 10),
        'upperArmR': (-14, 0, -28), 'foreArmR': (-30, 0, -10),
        'spine': (-5, 0, 0), 'chest': (7, 0, 0), 'neck': (-6, 0, 0),
        'head': (-4, 0, 0),
    },
    'singBig': {
        'upperArmL': (-30, 0, 68), 'foreArmL': (-24, 0, 8),
        'upperArmR': (-30, 0, -68), 'foreArmR': (-24, 0, -8),
        'spine': (-8, 0, 0), 'chest': (11, 0, 0), 'neck': (-9, 0, 0),
        'head': (-7, 0, 0),
    },
    'point': {
        'upperArmL': (-72, 0, 16), 'foreArmL': (-8, 0, 2), 'handL': (0, 0, 0),
        'upperArmR': (-4, 0, -6), 'foreArmR': (-14, 0, -3),
        'spine': (2, -8, 0), 'chest': (-1, 6, 0), 'neck': (0, 4, 0),
    },
    'cast': {
        'upperArmL': (-84, 0, 24), 'foreArmL': (-30, 0, 10),
        'upperArmR': (-84, 0, -24), 'foreArmR': (-30, 0, -10),
        'spine': (-6, 0, 0), 'chest': (9, 0, 0), 'neck': (-8, 0, 0),
        'head': (-5, 0, 0),
    },
    'castOne': {
        'upperArmL': (-96, 0, 18), 'foreArmL': (-18, 0, 6),
        'upperArmR': (-10, 0, -8), 'foreArmR': (-26, 0, -4),
        'spine': (-3, -6, 0), 'chest': (5, 4, 0), 'neck': (-4, 2, 0),
    },
    'reach': {
        'upperArmL': (-64, 0, 12), 'foreArmL': (-16, 0, 4),
        'upperArmR': (-58, 0, -12), 'foreArmR': (-20, 0, -4),
        'spine': (-4, 0, 0), 'chest': (6, 0, 0), 'neck': (-3, 0, 0),
    },
    'afraid': {
        'upperArmL': (-30, 0, 4), 'foreArmL': (-84, 0, 8),
        'upperArmR': (-30, 0, -4), 'foreArmR': (-84, 0, -8),
        'clavL': (0, 0, 8), 'clavR': (0, 0, -8),
        'spine': (8, 0, 0), 'chest': (6, 0, 0), 'neck': (8, 0, 0),
        'head': (6, 0, 0),
    },
    'angry': {
        'upperArmL': (-14, 0, 12), 'foreArmL': (-46, 0, 8),
        'upperArmR': (-14, 0, -12), 'foreArmR': (-46, 0, -8),
        'spine': (7, 0, 0), 'chest': (4, 0, 0), 'neck': (-4, 0, 0),
        'head': (-3, 0, 0), 'hips': (3, 0, 0),
    },
    'tender': {
        'upperArmL': (-40, 0, 6), 'foreArmL': (-76, 0, 12),
        'upperArmR': (-8, 0, -7), 'foreArmR': (-20, 0, -3),
        'spine': (3, 0, 0), 'chest': (-2, 0, 0), 'neck': (5, 0, 2),
        'head': (3, 0, 3),
    },
    'resolute': {
        'upperArmL': (-2, 0, 5), 'foreArmL': (-10, 0, 2),
        'upperArmR': (-2, 0, -5), 'foreArmR': (-10, 0, -2),
        'spine': (-3, 0, 0), 'chest': (4, 0, 0), 'neck': (-4, 0, 0),
        'head': (-3, 0, 0),
    },
    'sad': {
        'upperArmL': (-2, 0, 3), 'foreArmL': (-18, 0, 2),
        'upperArmR': (-2, 0, -3), 'foreArmR': (-18, 0, -2),
        'clavL': (0, 0, -6), 'clavR': (0, 0, 6),
        'spine': (9, 0, 0), 'chest': (5, 0, 0), 'neck': (12, 0, 0),
        'head': (8, 0, 0),
    },
    'joyful': {
        'upperArmL': (-40, 0, 74), 'foreArmL': (-30, 0, 14),
        'upperArmR': (-40, 0, -74), 'foreArmR': (-30, 0, -14),
        'spine': (-7, 0, 0), 'chest': (9, 0, 0), 'neck': (-8, 0, 0),
        'head': (-6, 0, 0),
    },
    'wonder': {
        'upperArmL': (-56, 0, 22), 'foreArmL': (-52, 0, 10),
        'upperArmR': (-8, 0, -6), 'foreArmR': (-18, 0, -3),
        'spine': (-5, 0, 0), 'chest': (6, 0, 0), 'neck': (-10, 0, 0),
        'head': (-8, 0, 0),
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
    'bow': {
        'upperArmL': (-18, 0, 10), 'foreArmL': (-40, 0, 6),
        'upperArmR': (-18, 0, -10), 'foreArmR': (-40, 0, -6),
        'spine': (34, 0, 0), 'chest': (12, 0, 0), 'neck': (-20, 0, 0),
        'head': (-10, 0, 0), 'hips': (8, 0, 0),
    },
    # kneel and sit are the only two poses anim.js gives legs to, because they
    # are the only two whose legs the browser's locomotion layer cannot infer.
    # THIS ONE DEVIATES FROM anim.js ON PURPOSE, and anim.js has been changed
    # to match. The inherited table was not a kneel: the left leg was a
    # correct raised leg (thigh horizontal, shin down, sole flat) but the
    # right was near straight at thigh -24 / shin 30, which is the geometry of
    # a leg standing slightly behind you. There is no pelvis height at which
    # both of those touch the floor, so whatever the root offset, one leg
    # hung in the air — measured at 0.41 m on the finished rig. It read as a
    # man doing a lunge in mid-fall.
    # A one-knee kneel needs the trailing leg FOLDED so the shin lies along
    # the floor. Solved by search rather than by eye: the pose and the offset
    # were varied together and the rig measured each time, and this pair puts
    # the raised sole and the kneeling shin within 0.6 mm of each other.
    'kneel': {
        'thighL': (-88, 0, 4), 'shinL': (96, 0, 0), 'footL': (-12, 0, 0),
        'thighR': (10, 0, -6), 'shinR': (100, 0, 0),
        'upperArmL': (-14, 0, 8), 'foreArmL': (-40, 0, 6),
        'upperArmR': (-14, 0, -8), 'foreArmR': (-40, 0, -6),
        'spine': (6, 0, 0), 'hips': (0, 0, 0),
    },
    'sit': {
        'thighL': (-84, 2, 3), 'shinL': (80, 0, 0), 'footL': (4, 0, 0),
        'thighR': (-84, -2, -3), 'shinR': (80, 0, 0), 'footR': (4, 0, 0),
        'upperArmL': (-10, 0, 6), 'foreArmL': (-46, 0, 6),
        'upperArmR': (-10, 0, -6), 'foreArmR': (-46, 0, -6),
        'spine': (3, 0, 0), 'chest': (-1, 0, 0),
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
    # A bow is made from the waist, and the torso ends up 42 degrees forward
    # (34 of spine on top of 8 of hips). Idle's stance cannot carry it: idle
    # puts the weight on one hip, which under that much lean reads as a
    # stumble rather than a bow. So: even weight, and the knees only just off
    # locked, because a deep knee bend under a bow is a curtsey.
    'bow': {
        'thighL': (-1, 0, 2), 'shinL': (2, 0, 0),
        'thighR': (-1, 0, -2), 'shinR': (2, 0, 0),
    },
    # kneel is the one pose anim.js leaves half-shod: it poses footL but not
    # footR, because in the browser the walk layer owns whichever foot is not
    # planted. The supporting (right) leg's thigh is 24 degrees forward and its
    # The kneeling foot is not standing on anything: the shin lies along the
    # floor, so the ankle extends and the figure rests on the top of the foot
    # and the toes, the way anyone kneeling on one knee actually does.
    'kneel': {
        'footR': (-52, 0, 0),
    },
}
# The rest of the library poses the upper body only — the browser plays those
# over whatever the legs are already doing, and a still wants the same relaxed
# stance underneath. Listed by name rather than defaulted inside
# pose_character, so this table stays the one place to look when a new pose
# stands wrong.
for _upper_body in ('listen', 'talk', 'idleAlt', 'talkBoth', 'sing', 'singBig',
                    'point', 'cast', 'castOne', 'reach', 'angry', 'tender',
                    'resolute', 'sad', 'joyful', 'wonder'):
    _LEG_LAYER[_upper_body] = _LEG_LAYER['idle']
# afraid is a recoil rather than a mood — same braced legs as flinch.
_LEG_LAYER['afraid'] = _LEG_LAYER['flinch']
del _upper_body


# How far the pelvis has to travel for a folded-leg pose to keep its feet on
# the floor, in metres in three.js convention (+Y up) for the reference 1.78 m
# figure. Rotations alone cannot do this: pose_character writes bone
# orientations, so folding the legs under a body whose root never moves leaves
# the feet where the rotation put them — 42 cm in the air — and `sit` renders
# as a person seated on nothing.
#
# The numbers are read off _skeleton, which expresses every joint as a fraction
# of stature h:
#
#     hip joint   0.5620 h * 0.96  = 0.53952 h      (thighL/R head)
#     thigh       0.53952 h - 0.278 h = 0.26152 h
#     shin        0.278 h - 0.052 h  = 0.226 h
#     ankle       0.052 h
#
# so standing, the hip joint is 0.53952 - 0.052 = 0.48752 h above the ankle.
# Folding the leg shortens that to thigh*cos(thigh angle from vertical) +
# shin*cos(shin angle), and the difference is the drop:
#
#   sit    thigh 84 deg, shin 4 deg (-84 + 80 of the pose table):
#          0.26152*cos84 + 0.226*cos4 = 0.0273 + 0.2255 = 0.2528 h
#          drop = 0.48752 - 0.2528 = 0.2347 h = 0.418 m
#   kneel  the pelvis rides on the kneeling thigh alone, which stands almost
#          vertical (10 deg back), so the drop is very nearly the whole shin:
#          0.226*cos100 is negative — the shin runs BACKWARD along the floor
#          rather than downward — leaving 0.26152*cos10 = 0.2576 h under the
#          hips. drop = 0.48752 - 0.2576 = 0.2299 h = 0.402 m by arithmetic,
#          0.454 m measured, the difference being ankle and sole thickness on
#          the raised leg, which the bone lengths alone do not account for.
#          The measurement wins; see the kneel entry in POSES.
#
# Measured on the finished rig: sit puts both soles within 5 mm of the floor
# and leaves the lowest hips-weighted vertex at 0.479 m — the height a chair
# seat has to be to be under it. Kneel puts the raised sole and the kneeling
# shin within 0.6 mm of each other, both on the floor.
#
# Both offsets were checked across all five builds (slim, average, sturdy,
# willowy, broad): _skeleton scales leg length by stature only and never by
# build, so the drop is build-invariant to seven decimal places.
#
# Everything else in the library stands on straight legs and must NOT be
# offset, or it sinks into the ground. Applied to the hips bone, which every
# other bone descends from, so the whole figure travels.
_ROOT_OFFSET = {
    'sit': (0.0, -0.418, 0.0),
    'kneel': (0.0, -0.454, 0.0),
}


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


def _three_vec_to_blender(v):
    """The same basis map as :func:`_three_euler_to_blender`, for offsets."""
    x, y, z = v
    return Vector((-x, z, y))


def pose_character(obj, pose='idle', intensity=1.0):
    """Apply a named pose from anim.js's library.

    Poses are authored as rotations *in world axes relative to the parent*,
    because the bind pose has every bone axis-aligned. Blender's
    ``matrix_basis`` is in the bone's own rest space instead, so each rotation
    is conjugated by that bone's rest matrix::

        basis = rest^-1 @ R_world @ rest

    Doing it this way means the bone roll and rest orientation can be whatever
    is convenient for modelling without any of the pose numbers changing.

    A folded-leg pose also moves the pelvis, from :data:`_ROOT_OFFSET`. That
    offset is a fraction of stature, so it is scaled by the figure's own
    height: every length in ``_skeleton`` is written as a fraction of h, and a
    1.55 m actor dropped by a 1.78 m actor's 0.418 m sits through the chair.

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
        # Location too, not just rotation: poses are applied over each other
        # shot after shot, and an idle that inherited sit's root offset stands
        # the actor 42 cm into the floor.
        pb.location = (0.0, 0.0, 0.0)

    for bone, (tx, ty, tz) in table.items():
        pb = rig.pose.bones.get(bone)
        if pb is None:
            continue
        r = _three_euler_to_blender(tx * intensity, ty * intensity,
                                    tz * intensity)
        rest = pb.bone.matrix_local.to_3x3()
        pb.rotation_quaternion = (rest.inverted() @ r @ rest).to_quaternion()

    offset = _ROOT_OFFSET.get(pose)
    hips = rig.pose.bones.get('hips')
    if offset and hips is not None:
        # Intensity scales the fold ANGLES, and the drop it causes goes as
        # 1 - cos(angle), which is quadratic in the angle near zero — so the
        # offset scales as intensity squared, not intensity. Measured on a
        # half-strength sit: scaling it linearly put the feet 90 mm through the
        # floor, squared leaves them 15 mm above it.
        drop = (_three_vec_to_blender(offset)
                * (float(rig.get('ph_height') or 1.78) / 1.78) * intensity ** 2)
        # A pose bone's location is in the bone's OWN rest space, not the
        # armature's. The hips bone points straight up, so its local -Y is the
        # world -Z we want; writing the world vector straight in would send the
        # pelvis sideways instead of down. rest^-1 does the conversion.
        hips.location = hips.bone.matrix_local.to_3x3().inverted() @ drop

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
    """A vertical gradient sky, dark below the horizon.

    A flat background colour is the single difference between "dusk" and "a
    grey studio". The warm-low / cool-high split also gives every shadow a
    colour rather than making it a hole, which is most of what stops CG
    shadows looking like cut-outs.

    THE LOWER HEMISPHERE IS NOT SKY.
        This gradient's first version clamped everything below the horizon to
        the horizon colour, which meant the whole bottom half of the world --
        every direction a downward-facing surface samples -- radiated warm
        light at full strength. Moving the ambient into sky strength then
        turned that into a genuine uplight rig: the set was lit from beneath
        as brightly as from above. Measured across ten frames it lifted the
        near-black coverage from 1.5% of pixels to 0.06%, i.e. it deleted the
        blacks, and with them the contrast the low key was there to create.

        A real environment reflects a fraction of the sky back up, tinted by
        whatever the ground is, and that fraction is small. Two extra stops
        below the horizon do it: a dim, desaturated bounce far down, and a
        tight ramp through the horizon line so the transition still reads as
        a horizon rather than as a smear.
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
    # Reaches well below the horizon now, so the ground bounce has somewhere
    # to live. Positions below are (z + 0.55) / 0.97.
    mr.inputs['From Min'].default_value = -0.55
    mr.inputs['From Max'].default_value = 0.42
    mr.clamp = True

    grey = sum(horizon) / 3.0
    # Ground bounce: 14% of the horizon's energy, pulled most of the way to
    # neutral because earth and leaf litter are not the colour of a sunset.
    bounce = tuple((c * 0.35 + grey * 0.65) * 0.14 for c in horizon)

    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (*bounce, 1.0)          # straight down
    ramp.color_ramp.elements[1].color = (*zenith, 1.0)          # straight up
    for position, colour in (
            (0.50, bounce),                                     # z = -0.065
            (0.58, horizon),                                    # z = +0.013
            # A stop just above the horizon keeps the gradient from being a
            # linear wash, which is what makes a procedural sky look procedural.
            (0.72, tuple(a * 0.62 + b * 0.38 for a, b in zip(horizon, zenith))),
    ):
        ramp.color_ramp.elements.new(position).color = (*colour, 1.0)
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
    kick_data.energy = 1.35 if mood != 'NIGHT' else 0.5
    # A 5-degree disc, not the 14 it was built with. The kick sits 28 degrees
    # off the lens axis, so it is the one light in the rig whose specular lobe
    # can actually reflect back into the camera -- the key is behind the
    # subject and reflects away, and the sky fill is the whole hemisphere. At
    # 14 degrees its highlight was smeared across so much of each surface that
    # it read as diffuse: measuring the ten rendered frames found no pixel
    # anywhere sitting more than a stop above its neighbours, on a set
    # containing a metal rifle and two metal drones. Tightening the disc is
    # what turns those materials' metalness back into something visible.
    kick_data.angle = math.radians(5.0)
    kick_data.color = kelvin_rgb(6800)
    kick = bpy.data.objects.new('kick', kick_data)
    scene.collection.objects.link(kick)
    aim_kick_light(kick, heading_deg)
    receivers = link_kick(kick, cast_objects, scene) if cast_objects else None

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
    # `kick_receivers` is handed back so the caller can add things the cast
    # picks up later. The collection is built here, before any `hold` action
    # has run, so a rifle drawn in shot 7 would otherwise be the one object on
    # a lit actor that the frontal light does not touch.
    return {'world': world, 'sun': sun, 'kick': kick, 'fill': fill,
            'fog': fog_obj, 'kick_receivers': receivers}


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
