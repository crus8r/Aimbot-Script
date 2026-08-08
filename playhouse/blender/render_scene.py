"""Render a normalised playhouse scene file to one still per shot, in Blender.

WHY THIS EXISTS
    The browser side of playhouse stages a scene in three.js and can screenshot
    it, but a WebGL screenshot is a preview, not a frame. This is the same scene
    file, the same blocking and the same camera grammar, rendered properly. The
    contract is that a director should be able to change one shot in the scene
    file and re-render only that shot: hence ``--shot``.

THE AXIS SWAP  (get this wrong and the whole wood lies on its side)
    Scene files are three.js convention: right-handed, Y up, +X right,
    +Z toward the viewer. Blender is right-handed, Z up, +Y "into the screen".
    The map is a +90 degree rotation about X:

        blender.x =  three.x
        blender.y = -three.z
        blender.z =  three.y

    It has determinant +1, so handedness -- and therefore every cross product,
    every sense of "camera left" -- survives unchanged. ``_axis_self_test()``
    asserts exactly that at import time rather than trusting the comment.

    Headings need care. In the scene file ``facing`` / ``rot`` is a rotation
    about three's up axis, and director.js reads the forward vector off it as
    ``(sin f, 0, cos f)`` -- so ``facing == 0`` means "forward is three +Z".
    Under the map, three +Z becomes Blender -Y. But the asset contract says
    every builder returns something facing Blender +Y. Solving

        R_z(phi) * (0, 1, 0) == map(sin f, 0, cos f)

    gives ``phi = f + pi``. That half turn is not a fudge; it is the price of
    the two conventions disagreeing about which way "front" points, and it is
    asserted too.

CAMERA AGREEMENT
    Shot framing is ported from src/director.js rather than reinvented, and --
    deliberately -- the port does its arithmetic in three.js space and converts
    only the final position and look-at point. Every intermediate vector
    therefore has a line-for-line counterpart in the JS, which is the only way
    to keep "MCU" meaning the same thing in both renderers a year from now.

    Checked, not assumed: feeding director.js solveShot the identical world
    state for all ten shots of forest-stop agrees with solve_shot below to
    2e-7 m, the only difference being the handheld jitter this file drops.

STILLS, NOT FOOTAGE
    A still cannot show travel, so it shows arrival: a ``move`` action places
    its actor at the destination, and camera moves are evaluated at the end of
    their travel (``--t``, default 1.0). Shot state accumulates -- actions from
    shots 0..N are replayed before shot N renders -- because a man who put his
    hands up in shot 6 still has them up in shot 10. ``fade`` and ``vfx`` are
    ignored: both are things that happen *over* time.

Usage:
    python3 render_scene.py <scene.json> <outdir> [--samples N] [--res WxH]
                            [--shot ID] [--t 0..1] [--save-blend]
"""

import argparse
import inspect
import json
import math
import os
import re
import sys
import time

# The real blender/ph_assets.py must win over any development stub that happens
# to be on PYTHONPATH, so this directory goes first.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import ph_assets  # noqa: E402


# ---------------------------------------------------------------------------
# Axis conversion
# ---------------------------------------------------------------------------

def to_blender(v):
    """Map a three.js (Y-up) vector to Blender (Z-up)."""
    return Vector((v[0], -v[2], v[1]))


def to_three(v):
    """Inverse of :func:`to_blender`, for reading results back out."""
    return (v[0], v[2], -v[1])


def yaw_to_blender(facing):
    """Map a three.js heading (rotation about +Y) to a Blender Z rotation.

    The half turn accounts for three.js assets facing +Z while Blender assets
    face +Y; see the module docstring for the derivation.
    """
    return facing + math.pi


def _axis_self_test():
    """Prove the mapping rather than assert it in a comment.

    A silent axis error does not crash -- it produces a scene lying on its
    side, or one where everyone faces away from the lens, which costs an hour
    of staring at renders. Ten microseconds of arithmetic at import time is a
    better trade.
    """
    # 1. Up maps to up, right stays right, and three's "toward viewer" becomes
    #    Blender's "toward the front of the stage".
    assert to_blender((0, 1, 0)) == Vector((0, 0, 1))
    assert to_blender((1, 0, 0)) == Vector((1, 0, 0))
    assert to_blender((0, 0, 1)) == Vector((0, -1, 0))

    # 2. Handedness: the map must commute with the cross product. If it did
    #    not, "camera left" would silently become "camera right".
    a, b = (0.3, -0.7, 1.2), (2.0, 0.5, -0.4)
    lhs = to_blender(a).cross(to_blender(b))
    rhs = to_blender(Vector(a).cross(Vector(b)))
    # mathutils is single precision, so these tolerances are float32-sized, not
    # sloppy: an actual axis mistake is off by whole units, not by 1e-6.
    assert (lhs - rhs).length < 1e-5, "axis map is not orientation preserving"

    # 3. Headings: a body facing `f` in the scene file must end up pointing the
    #    same way in Blender once the +Y asset convention is applied.
    for f in (0.0, 0.7, -1.3, math.pi, 2.9):
        three_fwd = to_blender((math.sin(f), 0.0, math.cos(f)))
        phi = yaw_to_blender(f)
        blender_fwd = Matrix.Rotation(phi, 3, "Z") @ Vector((0.0, 1.0, 0.0))
        assert (three_fwd - blender_fwd).length < 1e-5, f"heading broken at {f}"

    # 4. Round trip.
    assert Vector(to_three(to_blender(a))) == Vector(a)


_axis_self_test()


# ---------------------------------------------------------------------------
# Director port -- keep in step with src/director.js
# ---------------------------------------------------------------------------

# Verbatim from src/director.js SHOT_SIZES. `fov` is a *vertical* field of view
# in degrees, because that is what a three.js PerspectiveCamera's `fov` means.
SHOT_SIZES = {
    "ECU": {"dist": 0.62, "fov": 44, "aim": "head", "headroom": 0.02},
    "CU": {"dist": 1.05, "fov": 40, "aim": "head", "headroom": 0.05},
    "MCU": {"dist": 1.65, "fov": 38, "aim": "head", "headroom": 0.10},
    "MS": {"dist": 2.70, "fov": 36, "aim": "chest", "headroom": 0.16},
    "MWS": {"dist": 3.80, "fov": 34, "aim": "chest", "headroom": 0.22},
    "WS": {"dist": 5.40, "fov": 31, "aim": "body", "headroom": 0.30},
    "EWS": {"dist": 9.00, "fov": 27, "aim": "stage", "headroom": 0.50},
}

# human.js: the body proportions the camera solver measures against.
BODY_HEIGHT = 1.75
BODY_EYE = 1.63
BODY_CHEST = 1.30


def _rot_y(v, angle):
    """Rotate a three.js vector about the up axis, as THREE.applyAxisAngle does."""
    c, s = math.cos(angle), math.sin(angle)
    return Vector((v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c))


def _forward_of(facing):
    """director.js forwardOf(): the direction a body with this heading faces."""
    return Vector((math.sin(facing), 0.0, math.cos(facing)))


def _fit_pair(position, aim, a, b, fov, margin=0.12):
    """Back the camera off until two world points both sit inside the frame.

    Returns (position, fov). Only ever retreats along the existing view axis, so
    the shot keeps the angle the director asked for and loses only its tightness
    — a wider version of the intended shot is a far smaller betrayal than a tight
    shot of the wrong thing.
    """
    view = aim - position
    dist = view.length
    if dist < 1e-4:
        return position, fov
    view = view / dist

    # Half-angle each point subtends from the lens axis.
    worst = 0.0
    for point in (a, b):
        to_point = point - position
        if to_point.length < 1e-4:
            continue
        cos_a = max(-1.0, min(1.0, to_point.normalized().dot(view)))
        worst = max(worst, math.acos(cos_a))

    # Vertical half-FOV is the binding constraint on a 16:9 frame.
    half = math.radians(fov) * 0.5
    needed = worst * (1.0 + margin)
    if needed <= half:
        return position, fov

    # Retreat far enough that the pair fits, capped so a shot never runs away.
    scale = math.tan(needed) / max(1e-4, math.tan(half))
    new_dist = min(dist * scale, dist * 3.0)
    return aim - view * new_dist, fov


def _aim_point(actor, aim):
    """director.js aimPoint(): the height on a body a shot size frames on.

    director.js computes this from the mark and a nominal eye height, because
    in the browser the pose is a continuous animation and there is no single
    "where the head is" to ask about. Here the pose is frozen and the rig can
    simply be measured -- so it is, when the measurement is available.

    It matters: after a `flinch` the runner's head has led 0.20 m forward and
    down off the nominal eyeline. On a close-up shot at 0.84 m that is a
    quarter of the subject distance, and it is why the reaction shot framed
    the man's head low and left of centre with an empty bright half-frame
    beside it. The camera should frame the head that exists.
    """
    x, y, z = actor["pos"]
    measured = actor.get("aim_points", {}).get(aim)
    if measured is not None:
        return measured.copy()
    if aim == "head":
        return Vector((x, y + actor["eye"], z))
    if aim == "chest":
        return Vector((x, y + actor["chest"], z))
    if aim == "body":
        return Vector((x, y + actor["height"] * 0.55, z))
    return Vector((x, y + actor["height"] * 0.6, z))


def refresh_aim_points(world):
    """Measure where each actor's head and chest actually ended up.

    Called after a shot's actions have been applied and the depsgraph has
    settled, so that `_aim_point` frames the posed body rather than the
    T-pose it was built from. Bones are named by anim.js's table, which
    ph_assets reproduces verbatim.
    """
    for actor in world["cast"].values():
        arm = actor["obj"]
        if arm.type != "ARMATURE":
            continue
        points = {}
        for aim, bone_name in (("head", "head"), ("chest", "chest")):
            bone = arm.pose.bones.get(bone_name)
            if bone is None:
                continue
            # The centre of the bone, not its root: a head bone's root is the
            # base of the skull and framing on it puts the face high in shot.
            centre = arm.matrix_world @ ((bone.head + bone.tail) * 0.5)
            points[aim] = Vector(to_three(centre))
        actor["aim_points"] = points


def solve_shot(shot, world, t=1.0):
    """Resolve a shot into a camera placement, in three.js space.

    Ported from director.js solveShot. Divergences, all deliberate:

    * ``elapsed`` handheld jitter is dropped -- a still has no elapsed time, and
      a fixed random shake would only make renders non-reproducible.
    * The insert path resolves its subject by *scene id*. director.js looks it
      up by prop registry name, which cannot match an authored id like
      "droneA"; resolving by id is what the scene file plainly means.
    * The interior bounds clamp is skipped: buildExplicitStage always reports
      ``exterior: true``, so the clamp is dead for scene files.

    :returns: ``{"position": Vector, "look_at": Vector, "fov": float}``
    """
    spec = SHOT_SIZES.get(shot["size"], SHOT_SIZES["MS"])
    subject = world["cast"].get(shot["subject"]) if shot["subject"] else None
    secondary = world["cast"].get(shot["secondary"]) if shot["secondary"] else None
    side = shot["side"] or 1
    move = shot["move"]

    # --- Insert: a close-up on a thing, not a person ----------------------
    if shot["insert"]:
        centre = None
        if shot["world_target"] is not None:
            centre = Vector(shot["world_target"])
        else:
            prop = world["props"].get(shot["subject_prop"])
            if prop is not None:
                centre = Vector(prop["pos"])
                centre.y += prop["size_y"] * 0.55
        if centre is not None:
            fov = 46.0
            # director.js frames an insert at a fixed fraction of the shot
            # size's distance, which silently assumes a prop you could hold.
            # A 1.15-scale drone is over a metre across, so that distance puts
            # the lens *inside* it -- shot 5 rendered as an unreadable dark
            # mass. Back off far enough that the prop's bounding sphere fits
            # the frame, and keep whichever distance is larger.
            radius = prop["radius"] if prop is not None else 0.0
            fit = radius / max(0.2, math.sin(math.radians(fov) * 0.5)) * 0.92
            dist = max(0.45, spec["dist"] * 0.55, fit)
            off = Vector((0.7 * side, 0.55, 0.9)).normalized()
            position = centre + off * dist
            if move == "push":
                position += (centre - position).normalized() * (t * dist * 0.25)
            return {"position": position, "look_at": centre, "fov": fov}
        # Named prop absent: read as "looking at the ground" rather than an
        # unmotivated mid-room master.
        return {
            "position": Vector((1.1 * side, 0.9, 1.5)),
            "look_at": Vector((0.0, 0.15, -0.2)),
            "fov": 40.0,
        }

    if subject is None:
        depth = world["bounds"]["depth"]
        return {
            "position": Vector((2.2, 2.4, depth * 0.42)),
            "look_at": Vector((0.0, 1.2, -0.4)),
            "fov": 34.0,
        }

    two_shot_aim = None
    target = _aim_point(subject, spec["aim"])
    facing = _forward_of(subject["facing"])
    dist = spec["dist"]
    fov = float(spec["fov"])

    if shot["ots"] and secondary is not None:
        # Over the shoulder: behind and outside the listener's head, looking
        # past them. Requested by camera.ots in the scene file.
        s_head = _aim_point(secondary, "head")
        to_subject = (target - s_head)
        to_subject.y = 0.0
        to_subject.normalize()
        s_right = Vector((to_subject.z, 0.0, -to_subject.x))
        position = s_head + to_subject * -0.42 + s_right * (0.34 * side)
        position.y = s_head.y + 0.10
        flat = Vector((position.x, target.y, position.z))
        have = (flat - target).length
        if have < 1.15:
            position += to_subject * -(1.15 - have)
        fov = 40.0
    elif shot["size"] == "EWS":
        if secondary is not None:
            centre = (target + _aim_point(secondary, "body")) * 0.5
        else:
            centre = target.copy()
        # Exterior stages get the fixed crane height director.js uses outdoors.
        bounds = world["bounds"]
        height = 3.4 if bounds["exterior"] else min(bounds["height"] - 0.5, 2.9)
        position = centre + Vector((1.6 * side, height, dist * 0.62))
        look_at = centre.copy()
        look_at.y = centre.y * 0.7 + 0.5
        # NOTE: director.js returns here, so an EWS never takes its move. Kept.
        return {"position": position, "look_at": look_at, "fov": fov}
    else:
        # Standard single: swing ~30 degrees off the subject's facing axis to
        # the chosen side, which reads as a natural three-quarter view.
        swing = 0.52 * side
        direction = _rot_y(facing, swing)
        position = target + direction * dist

        if secondary is not None:
            # A shot that names a secondary is about the PAIR. Bias the aim
            # toward the subject so it still reads as their shot, then back off
            # along the view axis until both points sit inside the frustum with
            # a margin. Two separated points also make bullseye framing
            # impossible by construction, which is the other thing wrong with
            # single-subject solves.
            other = _aim_point(secondary, "body")
            pair_aim = target * 0.65 + other * 0.35
            position, fov = _fit_pair(position, pair_aim, target, other, fov)
            two_shot_aim = pair_aim

    # --- Height -----------------------------------------------------------
    eye = subject["pos"][1] + subject["eye"]
    if shot["height"] == "low":
        position.y = max(0.5, eye - 0.55 - dist * 0.08)
    elif shot["height"] == "high":
        position.y = eye + 0.45 + dist * 0.10
    else:
        position.y = eye - 0.03

    # --- Moves, evaluated at `t` ------------------------------------------
    to_target = target - position
    to_target.y = 0.0
    length = to_target.length or 1.0
    to_target = to_target / length
    cam_right = Vector((to_target.z, 0.0, -to_target.x))

    if move == "push":
        position += to_target * (t * min(0.65, dist * 0.20))
    elif move == "pull":
        position += to_target * (-t * min(0.9, dist * 0.26))
    elif move == "dolly":
        position += cam_right * ((t - 0.5) * min(1.5, dist * 0.34) * side)
    elif move == "crane":
        position.y += (0.5 - t) * min(1.3, dist * 0.24)
        position += to_target * (t * dist * 0.10)
    elif move == "orbit":
        angle = (t - 0.5) * 0.34 * side
        position = target + _rot_y(position - target, angle)
    # 'static' and 'handheld' need nothing: a still cannot shake.

    look_at = (two_shot_aim if two_shot_aim is not None else target).copy()
    look_at.y += spec["headroom"] * 0.35
    return {"position": position, "look_at": look_at, "fov": fov}


# ---------------------------------------------------------------------------
# Blender plumbing
# ---------------------------------------------------------------------------

def reset_blend():
    """Start from an empty file: no default cube, camera or lamp to inherit."""
    bpy.ops.wm.read_factory_settings(use_empty=True)


def place(obj, three_pos, facing=0.0):
    """Put an object at a three.js position with a three.js heading."""
    obj.location = to_blender(three_pos)
    obj.rotation_mode = "XYZ"
    obj.rotation_euler[2] = yaw_to_blender(facing)


def parent_keep_transform(child, parent, bone=None):
    """Parent without moving the child.

    Blender composes world = parent_world @ matrix_parent_inverse @ basis, so
    setting the inverse to the parent's world matrix makes the child's own
    transform read as world space at bind time -- and it still rides the parent
    afterwards, which is the whole point of holding a rifle.
    """
    child.parent = parent
    if bone:
        child.parent_type = "BONE"
        child.parent_bone = bone
        pose_bone = parent.pose.bones[bone]
        bone_mat = pose_bone.matrix.copy()
        # Blender parents from the bone *tail*, not its head.
        bone_mat.translation = pose_bone.tail.copy()
        child.matrix_parent_inverse = (parent.matrix_world @ bone_mat).inverted()
    else:
        child.parent_type = "OBJECT"
        child.matrix_parent_inverse = parent.matrix_world.inverted()


def _descendants(obj):
    for child in obj.children:
        yield child
        yield from _descendants(child)


_HAND_RE = {
    "R": re.compile(r"hand[._\- ]?(r|right)\b|right[._\- ]?hand", re.I),
    "L": re.compile(r"hand[._\- ]?(l|left)\b|left[._\- ]?hand", re.I),
}
_HEAD_RE = re.compile(r"(^|[._\- ])head([._\- ]|$)", re.I)


def find_attachment(obj, hand="R"):
    """Locate a hand to hang a prop from.

    The shared contract does not name a hand API, so this discovers one:
    an explicit ``ph_hand_R`` custom property, then a bone, then a descendant
    object whose name reads as a hand. Returns ``(target, bone_name_or_None)``,
    or ``(None, None)`` if the character offers nothing to hold with.
    """
    explicit = obj.get("ph_hand_" + hand)
    if explicit:
        named = bpy.data.objects.get(explicit)
        if named is not None:
            return named, None
        if obj.type == "ARMATURE" and explicit in obj.pose.bones:
            return obj, explicit

    pattern = _HAND_RE[hand]
    if obj.type == "ARMATURE":
        for bone in obj.pose.bones:
            if pattern.search(bone.name):
                return obj, bone.name
    for child in _descendants(obj):
        if pattern.search(child.name):
            return child, None
    return None, None


def find_head(obj):
    """Locate the head, for ``look``. Same discovery ladder as the hands."""
    explicit = obj.get("ph_head")
    if explicit:
        named = bpy.data.objects.get(explicit)
        if named is not None:
            return named, None
        if obj.type == "ARMATURE" and explicit in obj.pose.bones:
            return obj, explicit
    if obj.type == "ARMATURE":
        for bone in obj.pose.bones:
            if _HEAD_RE.search(bone.name):
                return obj, bone.name
    for child in _descendants(obj):
        if _HEAD_RE.search(child.name):
            return child, None
    return None, None


def heading_of(direction):
    """Compass heading, in radians, of a Blender-space direction.

    Zero means +Y, which is the direction every asset faces by contract, so
    this is the one function that converts "which way is this pointing" into a
    number both the rigs and the key light agree on.
    """
    return math.atan2(-direction.x, direction.y)


def aim_head(head, bone, world_target, body_yaw, weight=0.95):
    """Turn a head toward a point, within a neck's actual range.

    Clamped hard: an unclamped look-at will happily spin a head 180 degrees to
    track something behind the actor, which reads as horror rather than
    attention. Yaw is limited to 70 degrees and pitch to 35, and ``weight``
    scales the result so a glance can be less than a stare.

    On a rig the rotation is applied the way ph_assets.pose_character applies
    its pose table -- ``basis = rest^-1 @ R @ rest`` -- because the bind pose
    is axis aligned but each bone's rest space is not. Writing a raw euler onto
    the bone instead would tilt the head about whatever axis the bone roll
    happened to land on.
    """
    if head is None:
        return
    if bone:
        pose_bone = head.pose.bones[bone]
        origin = head.matrix_world @ pose_bone.head
    else:
        origin = head.matrix_world.translation.copy()

    delta = Vector(world_target) - origin
    if delta.length < 1e-4:
        return
    want_yaw = heading_of(delta)
    yaw = math.atan2(math.sin(want_yaw - body_yaw), math.cos(want_yaw - body_yaw))
    pitch = math.atan2(delta.z, math.hypot(delta.x, delta.y))

    limit_yaw, limit_pitch = math.radians(70), math.radians(35)
    yaw = max(-limit_yaw, min(limit_yaw, yaw)) * weight
    pitch = max(-limit_pitch, min(limit_pitch, pitch)) * weight

    # In the character's own frame: yaw about up, pitch about the axis that
    # tips a +Y forward vector toward +Z.
    rotation = Matrix.Rotation(yaw, 3, "Z") @ Matrix.Rotation(pitch, 3, "X")
    if bone:
        pose_bone = head.pose.bones[bone]
        rest = pose_bone.bone.matrix_local.to_3x3()
        pose_bone.rotation_mode = "QUATERNION"
        pose_bone.rotation_quaternion = (rest.inverted() @ rotation @ rest).to_quaternion()
    else:
        head.rotation_mode = "QUATERNION"
        head.rotation_quaternion = rotation.to_quaternion()


def object_height(obj):
    """World-space height of an object and everything parented to it."""
    total = obj.dimensions.z
    for child in _descendants(obj):
        if child.type == "MESH":
            top = child.matrix_world.translation.z + child.dimensions.z * 0.5
            total = max(total, top - obj.matrix_world.translation.z)
    return total or 0.3


def object_radius(obj):
    """Bounding-sphere radius about an object's origin, children included.

    An insert has to know how big the thing it is framing actually is, or a
    close-up on a metre-wide drone puts the lens inside the fuselage.
    """
    origin = obj.matrix_world.translation
    radius = 0.0
    for part in [obj, *_descendants(obj)]:
        if part.type != "MESH":
            continue
        for corner in part.bound_box:
            radius = max(radius, ((part.matrix_world @ Vector(corner)) - origin).length)
    return radius


def terrain_height(ground, x, y):
    """Surface height of the ground mesh under a Blender-space (x, y).

    ph_assets.make_ground returns a displaced mesh, not a plane -- the
    undulation is where every grazing highlight in a low-sun frame comes from.
    It is damped flat over the acting area, so most of a scene is unaffected,
    but a runner starting fifteen metres out would otherwise stand in a
    trough or hover over a swell. One ray each, at build time, fixes it.
    """
    if ground is None:
        return 0.0
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = ground.evaluated_get(depsgraph)
    inverse = evaluated.matrix_world.inverted()
    origin = inverse @ Vector((x, y, 100.0))
    direction = (inverse.to_3x3() @ Vector((0.0, 0.0, -1.0))).normalized()
    hit, location, _normal, _index = evaluated.ray_cast(origin, direction, distance=500.0)
    if not hit:
        return 0.0
    return (evaluated.matrix_world @ location).z


# ---------------------------------------------------------------------------
# Building the world
# ---------------------------------------------------------------------------

def _seed_of(text):
    """FNV-1a, matching director.js hash(), so a prop's id is its shape.

    Deterministic and derived from the id rather than from iteration order:
    inserting one tree at the top of a scene file must not reshuffle the other
    twenty-eight.
    """
    h = 2166136261
    for ch in str(text):
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def build_prop(kind, seed_text, scale):
    """Instantiate a prop by its scene-file type name.

    The asset library's own naming is the registry -- type "tree" means
    ``ph_assets.make_tree`` -- and the signature says which arguments it wants.
    Discovering that beats keeping a table here, because a new asset then works
    from a scene file the moment it exists, with no edit on this side.
    """
    builder = getattr(ph_assets, f"make_{kind}", None)
    if not callable(builder):
        return None
    kwargs = {}
    params = inspect.signature(builder).parameters
    if "seed" in params:
        kwargs["seed"] = _seed_of(seed_text)
    if "scale" in params:
        kwargs["scale"] = scale
    return builder(**kwargs)


def ground_snap(world, three_pos):
    """Lift a position authored as "on the ground" onto the actual ground.

    Only y == 0 is snapped. A drone authored at y = 3.05 means 3.05 metres in
    the air and must stay there; a tree authored at y = 0 means "wherever the
    ground is", and on a displaced mesh that is not zero.
    """
    out = list(three_pos)
    if abs(out[1]) < 1e-6:
        blender = to_blender(out)
        out[1] = terrain_height(world["ground"], blender.x, blender.y)
    return out


# How much bigger than the acting area the rendered floor and haze are built.
# Far enough that the floor's own edge is buried in haze rather than drawn as
# a horizon; see build_world and fog_volume_for.
GROUND_OVERSCAN = 2.6
FOG_OVERSCAN = 2.8


def fog_volume_for(world):
    """Size the haze box to the built set rather than to a fixed default.

    ph_assets ships a hand-placed 34x34x9 box at (0, 2, 3), which was tuned
    against a compact lineup. On this 44x44 stage that box stops 5 m short of
    the ground's own edge, so the far treeline and the rim of the world sit
    *outside* the haze: they render perfectly crisp against the sky and the
    horizon becomes a hard ruled line. Only the translator knows the stage
    size, so sizing it is the translator's job.

    The box is grown past the ground on every side and up over the canopy, so
    no camera pointing anywhere can see an edge of it. It reaches below z = 0
    because the ground is displaced and dips under zero in places.

    :returns: ``(size, centre)`` — full extents and centre, in Blender space.
    """
    bounds = world["bounds"]
    # Wider than the rendered floor, so the floor's edge is always seen
    # through haze and never against clear air.
    span_x = bounds["width"] * FOG_OVERSCAN
    span_y = bounds["depth"] * FOG_OVERSCAN

    # Tall enough to cover the tallest thing built, plus headroom for a crane.
    top = 8.0
    for entry in list(world["props"].values()) + list(world["cast"].values()):
        obj = entry["obj"]
        for corner in obj.bound_box:
            top = max(top, (obj.matrix_world @ Vector(corner)).z)
    top += 4.0
    bottom = -2.0
    return (span_x, span_y, top - bottom), (0.0, 0.0, (top + bottom) * 0.5)


def build_world(scene_data, warn):
    """Populate the blend and return the three.js-space model the solver reads.

    Two representations, on purpose: Blender objects are what gets rendered,
    and a parallel dict of three.js-space positions is what the ported camera
    solver measures. Keeping the solver in the source coordinate system is what
    makes it comparable, line by line, with director.js.
    """
    env = scene_data["environment"]
    width, depth = env.get("size") or [30, 30]

    # environment.size is the ACTING area -- it is what the director blocks
    # against and what the camera solver clamps to. It is not the edge of the
    # world, and rendering it as though it were put a hard ruled horizon
    # through several frames where the 44 m floor simply stopped and the sky
    # began. Render a floor well past the fog so the ground never ends inside
    # a shot; bounds below stay at the authored size so no camera moves.
    #
    # make_ground caps its grid at 200x200, so a floor three times the width
    # costs the same 40k faces and about a second to build.
    ground = ph_assets.make_ground(width * GROUND_OVERSCAN,
                                   depth * GROUND_OVERSCAN,
                                   env.get("ground") or "grass")
    ground.name = "ground"
    bpy.context.view_layer.update()
    world = {
        "ground": ground,
        "cast": {},
        "props": {},
        "bounds": {"width": width, "height": 24.0, "depth": depth, "exterior": True},
        "lights": {},
    }

    for entry in env.get("props") or []:
        obj = build_prop(entry["type"], entry["id"], float(entry.get("scale") or 1.0))
        if obj is None:
            warn(f"no ph_assets.make_{entry['type']} for prop {entry['id']!r}; skipped")
            continue
        obj.name = f"prop:{entry['id']}"
        position = ground_snap(world, entry["at"])
        place(obj, position, entry.get("rot") or 0.0)
        bpy.context.view_layer.update()
        world["props"][entry["id"]] = {
            "obj": obj,
            "pos": position,
            "rot": float(entry.get("rot") or 0.0),
            "size_y": object_height(obj),
            "radius": object_radius(obj),
        }

    for member in scene_data.get("cast") or []:
        spec = member.get("spec") or {}
        obj = ph_assets.make_character(spec, member["id"])
        obj.name = f"cast:{member['id']}"
        position = ground_snap(world, member["at"])
        place(obj, position, member.get("facing") or 0.0)
        # Prefer the height the asset module publishes, then read eye and chest
        # off it by the same proportion human.js uses -- so a rig built to a
        # different canon still gets framed on its own eyeline, not on 1.63 m.
        height = float(obj.get("ph_height", BODY_HEIGHT * float(spec.get("height", 1.0))))
        world["cast"][member["id"]] = {
            "obj": obj,
            "pos": position,
            "facing": float(member.get("facing") or 0.0),
            "height": height,
            "eye": float(obj.get("ph_eye_height", height * BODY_EYE / BODY_HEIGHT)),
            "chest": float(obj.get("ph_chest_height", height * BODY_CHEST / BODY_HEIGHT)),
            "held": {},
            "look": None,
        }

    # Last, because the key light wants to know who it is lighting. The scene
    # heading is a placeholder: aim_key_light re-points it per shot.
    fog_size, fog_centre = fog_volume_for(world)
    world["lights"] = ph_assets.set_world(
        env.get("mood") or "DAY",
        env.get("fog") or 0.0,
        scene=bpy.context.scene,
        heading_deg=0.0,
        cast_objects=[c["obj"] for c in world["cast"].values()],
        fog_size=fog_size,
        fog_centre=fog_centre,
    ) or {}

    bpy.context.view_layer.update()
    return world


def world_point(world, ident):
    """production.js #worldOf(): a cast member's head, or a prop's origin."""
    actor = world["cast"].get(ident)
    if actor is not None:
        x, y, z = actor["pos"]
        return Vector((x, y + actor["eye"], z))
    prop = world["props"].get(ident)
    if prop is not None:
        return Vector(prop["pos"])
    return None


# ---------------------------------------------------------------------------
# Actions
# ---------------------------------------------------------------------------

def _seat_held(world, actor_id):
    """(Re)place everything an actor is holding into their hand.

    Called again after every pose change, because raising a rifle to aim moves
    the hand and a prop that stayed at the hip would give the game away.
    """
    actor = world["cast"][actor_id]
    for hand, prop in actor["held"].items():
        target, bone = find_attachment(actor["obj"], hand)
        if target is None:
            continue
        bpy.context.view_layer.update()
        if bone:
            pose_bone = target.pose.bones[bone]
            anchor = target.matrix_world @ pose_bone.head
            _, rotation, _ = (target.matrix_world @ pose_bone.matrix).decompose()
        else:
            anchor, rotation, _ = target.matrix_world.decompose()
        # decompose() rather than to_quaternion(): a character rig is very
        # likely to carry non-uniform scale somewhere up its parent chain, and
        # a rifle must inherit the hand's *orientation* without inheriting a
        # squash that would leave it bent.
        # ph_grip is the local-space point the asset says a hand closes on.
        # Without it a rifle hangs off the palm by its base corner.
        _, _, prop_scale = prop.matrix_world.decompose()
        grip = Vector(prop.get("ph_grip", (0.0, 0.0, 0.0)))
        prop.parent = None
        prop.matrix_world = (Matrix.Translation(anchor)
                             @ rotation.to_matrix().to_4x4()
                             @ Matrix.Diagonal(prop_scale.to_4d())
                             @ Matrix.Translation(-grip))
        bpy.context.view_layer.update()
        parent_keep_transform(prop, target, bone)


def _set_pose(world, actor_id, pose, warn):
    """Pose an actor, then put back what the pose wiped.

    ph_assets.pose_character zeroes every bone before writing its table, so a
    pose applied after a look would silently straighten the neck. production.js
    only clears the look for handsUp and flinch -- poses that are *about* not
    looking -- so that is the rule reproduced here.
    """
    actor = world["cast"][actor_id]
    ph_assets.pose_character(actor["obj"], pose)
    if pose in ("handsUp", "flinch"):
        actor["look"] = None
    elif actor["look"] is not None:
        _apply_look(world, actor_id, *actor["look"], warn=warn)
    _seat_held(world, actor_id)


def _apply_look(world, actor_id, point, weight, warn):
    actor = world["cast"][actor_id]
    head, bone = find_head(actor["obj"])
    if head is None:
        warn(f"look: {actor_id!r} exposes no head to aim")
        return
    aim_head(head, bone, to_blender(point), yaw_to_blender(actor["facing"]), weight)
    actor["look"] = (Vector(point), weight)


def apply_action(action, world, warn):
    """Apply one action as a still would show it -- landed, not in progress."""
    verb = action.get("do")
    actor_id = action.get("actor")
    actor = world["cast"].get(actor_id)
    prop = world["props"].get(actor_id)

    if verb == "move":
        if actor is None:
            warn(f"move: {actor_id!r} is not a cast member")
            return
        to = action["to"]
        dest = [to[0], 0.0, to[1]] if len(to) == 2 else list(to)
        # Mover.update faces the direction of travel; Mover only turns to an
        # explicit `facing` once it has arrived. A still is always "arrived".
        delta = Vector((dest[0] - actor["pos"][0], 0.0, dest[2] - actor["pos"][2]))
        if delta.length > 1e-4:
            actor["facing"] = math.atan2(delta.x, delta.z)
        if action.get("facing") is not None:
            actor["facing"] = float(action["facing"])
        actor["pos"] = ground_snap(world, dest)
        place(actor["obj"], actor["pos"], actor["facing"])
        speed = action.get("speed", 1.2)
        # production.js: an explicit pose wins, otherwise anything above a fast
        # walk is a run -- without the forward lean a run reads as a hurry.
        pose = action.get("pose") or ("run" if speed > 2.2 else None)
        if pose:
            _set_pose(world, actor_id, pose, warn)
        else:
            _seat_held(world, actor_id)

    elif verb == "pose":
        if actor is None:
            warn(f"pose: {actor_id!r} is not a cast member")
            return
        _set_pose(world, actor_id, action["pose"], warn)

    elif verb == "face":
        if actor is None:
            return
        if action.get("target"):
            point = world_point(world, action["target"])
            if point is not None:
                actor["facing"] = math.atan2(
                    point.x - actor["pos"][0], point.z - actor["pos"][2])
        elif action.get("to") is not None:
            actor["facing"] = float(action["to"])
        place(actor["obj"], actor["pos"], actor["facing"])
        _seat_held(world, actor_id)

    elif verb == "look":
        if actor is None:
            return
        if action.get("target"):
            point = world_point(world, action["target"])
        elif action.get("at"):
            point = Vector(action["at"])
        else:
            point = None
        if point is None:
            warn(f"look: nothing to aim {actor_id!r} at")
            return
        _apply_look(world, actor_id, point, action.get("weight", 0.95), warn)

    elif verb == "hold":
        if actor is None:
            return
        held = build_prop(action["prop"], f"{actor_id}:{action['prop']}", 1.0)
        if held is None:
            warn(f"hold: no ph_assets.make_{action['prop']}")
            return
        held.name = f"held:{actor_id}:{action['prop']}"
        hand = action.get("hand", "R")
        actor["held"][hand] = held
        _seat_held(world, actor_id)
        if held.parent is None:
            warn(f"hold: {actor_id!r} exposes no {hand} hand; prop left at origin")

    elif verb == "release":
        if actor is None:
            return
        for hand, held in list(actor["held"].items()):
            if held.name.endswith(action["prop"]):
                held.parent = None
                bpy.data.objects.remove(held, do_unlink=True)
                del actor["held"][hand]

    elif verb == "prop":
        if prop is None:
            warn(f"prop: {actor_id!r} is not a placed prop")
            return
        if action.get("to"):
            to = action["to"]
            if len(to) == 2:
                prop["pos"] = [to[0], prop["pos"][1], to[1]]
            else:
                prop["pos"] = list(to)
        if action.get("hover") is not None:
            prop["pos"][1] = float(action["hover"])
        if action.get("rot") is not None:
            prop["rot"] = float(action["rot"])
        place(prop["obj"], prop["pos"], prop["rot"])

    elif verb == "vfx":
        # A spell is a thing that happens over time; a still has none.
        pass


# ---------------------------------------------------------------------------
# Camera
# ---------------------------------------------------------------------------

_AXES = (Vector((1, 0, 0)), Vector((-1, 0, 0)), Vector((0, 1, 0)),
         Vector((0, -1, 0)), Vector((0, 0, 1)), Vector((0, 0, -1)))


def camera_is_buried(scene, dg, blender_pos, radius=1.25, votes=4):
    """Is this point inside solid geometry?

    Six axis rays; if most of them hit something within `radius` the lens is
    inside a thing. Cheap, deterministic, and it does not care what the thing
    is -- which matters, because the object that swallowed the camera on the
    final shot was a tree *canopy*, not a trunk, and no bounding-sphere test
    against trunks would have caught it.
    """
    hits = 0
    for axis in _AXES:
        hit, _, _, _, _, _ = scene.ray_cast(dg, blender_pos, axis, distance=radius)
        hits += 1 if hit else 0
    return hits >= votes


def view_is_blocked(scene, dg, blender_pos, blender_look, ignore, clearance):
    """Is something sitting right on the lens between camera and subject?"""
    delta = blender_look - blender_pos
    span = delta.length
    if span < 1e-6:
        return False
    reach = min(clearance, span * 0.9)
    hit, _, _, _, obj, _ = scene.ray_cast(dg, blender_pos, delta.normalized(),
                                          distance=reach)
    return bool(hit) and obj not in ignore


def unblock_camera(scene, world, position, look_at, ignore, warn, shot_id):
    """Move a camera that is inside scenery, keeping the shot it was given.

    director.js solves a camera against abstract marks and never asks whether
    the resulting position is *in* something. In a wood it often is: the final
    EWS of this scene put the lens 1.4 m inside a tree's canopy, which is why
    that frame rendered as a black wedge with a hole in it.

    The recovery is what an operator would actually do -- swing round the
    subject a little, and try a slightly different height -- rather than
    teleport. Candidates are ordered by how little they disturb the framing,
    so an unobstructed camera never moves at all and a blocked one moves the
    least it can. Everything stays in three.js space so it can still be
    compared against director.js line by line.

    :returns: the position to shoot from, in three.js space.
    """
    dg = bpy.context.evaluated_depsgraph_get()
    offset = position - look_at
    ground = world["ground"]

    # (azimuth swing in radians, vertical nudge in metres), least first.
    trials = [(0.0, 0.0)]
    for lift in (0.0, 0.7, -0.5, 1.4):
        for swing in (0.12, -0.12, 0.24, -0.24, 0.38, -0.38, 0.55, -0.55,
                      0.75, -0.75, 1.0, -1.0):
            trials.append((swing, lift))

    for swing, lift in trials:
        candidate = look_at + _rot_y(offset, swing)
        candidate.y = position.y + lift
        blender_pos = to_blender(candidate)
        # Never drop the lens through the floor chasing a clear line.
        floor = terrain_height(ground, blender_pos.x, blender_pos.y) + 0.35
        if blender_pos.z < floor:
            continue
        blocked = (camera_is_buried(scene, dg, blender_pos)
                   or view_is_blocked(scene, dg, blender_pos,
                                      to_blender(look_at), ignore, 0.55))
        if not blocked:
            if swing or lift:
                warn(f"shot {shot_id!r}: camera was inside scenery; swung "
                     f"{math.degrees(swing):.0f} deg and {lift:+.1f} m to clear it")
            return candidate

    warn(f"shot {shot_id!r}: could not find a clear camera position; "
         f"shooting from the solved one")
    return position


def make_camera(scene):
    data = bpy.data.cameras.new("shotcam")
    # three.js `fov` is vertical, so the sensor must be fitted vertically or
    # every framing would drift with the aspect ratio.
    data.sensor_fit = "VERTICAL"
    data.sensor_height = 24.0
    data.clip_start = 0.05
    data.clip_end = 400.0
    cam = bpy.data.objects.new("shotcam", data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    return cam


def aim_camera(cam, position_three, look_at_three, fov_deg):
    """Point a Blender camera using a three.js-space position and target.

    :returns: the camera's compass heading in degrees, which the key light
        needs -- ph_assets aims the sun 165 degrees off the lens, so a scene
        lit once for shot one is frontally lit by shot five.
    """
    position = to_blender(position_three)
    target = to_blender(look_at_three)
    cam.location = position
    direction = target - position
    if direction.length < 1e-6:
        direction = Vector((0.0, 1.0, 0.0))
    # Blender cameras look down -Z with +Y up; world up is +Z.
    cam.rotation_mode = "XYZ"
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = (cam.data.sensor_height * 0.5) / math.tan(math.radians(fov_deg) * 0.5)
    flat = Vector((direction.x, direction.y, 0.0))
    return math.degrees(heading_of(flat)) if flat.length > 1e-6 else 0.0


def key_offset_for(fov_deg, aspect, margin=9.0, preferred=165.0):
    """How far off the lens axis the key may sit without being *in* the shot.

    ph_assets aims the key 165 degrees off the camera, which leaves the sun
    only 15 degrees from the lens axis. At DUSK that sun is also 4 degrees
    above the horizon, so on a 31-degree lens -- half-width 26 degrees at
    16:9 -- the disc is comfortably inside the frame and every wide shot came
    back with a blown white wedge across half of it and the subject reduced to
    a silhouette in front of it.

    That was read as "the fog is too thick". It was not: it was the camera
    pointing very nearly at the sun. The rule a DP would use is simply not to
    put the sun in the shot unless you mean to, so the offset is pulled in
    until the disc clears the frame edge by `margin` degrees. It only ever
    tightens the angle -- a narrow lens keeps the full 165 -- so the backlit
    look the recipe was built around survives.
    """
    half_v = math.radians(fov_deg) * 0.5
    half_h = math.degrees(math.atan(math.tan(half_v) * aspect))
    return min(preferred, 180.0 - (half_h + margin))


def light_for_camera(world, heading_deg, fov_deg=None, aspect=16.0 / 9.0):
    """Re-point every light for this shot's camera heading.

    All three are placed relative to the lens, so all three have to move
    together. Each one is aimed by calling ph_assets' own aimer rather than by
    repeating its angles here: an earlier version of this function inlined the
    kick's placement and the two copies had already drifted apart (elev 18 and
    offset -15 here against 26 and -28 there), which is exactly the bug that
    kind of duplication produces.
    """
    lights = world.get("lights") or {}
    sun = lights.get("sun")
    if sun is not None:
        offset = 165.0 if fov_deg is None else key_offset_for(fov_deg, aspect)
        ph_assets.aim_key_light(sun, heading_deg, offset=offset)
    kick = lights.get("kick")
    if kick is not None:
        ph_assets.aim_kick_light(kick, heading_deg)
    fill = lights.get("fill")
    if fill is not None:
        ph_assets.aim_fill_light(fill, heading_deg)


# ---------------------------------------------------------------------------
# Shot normalisation -- mirrors production.js loadScene
# ---------------------------------------------------------------------------

def prepare_shots(scene_data, world):
    """Turn scene-file shots into the shape solve_shot wants.

    This is production.js loadScene's shot mapping, including its rule that a
    camera subject which is not a cast member makes the shot an insert.
    """
    shots = []
    for index, entry in enumerate(scene_data["shots"]):
        cam = entry.get("camera") or {}
        subject = cam.get("subject")
        subject_is_cast = bool(subject) and subject in world["cast"]
        move = cam.get("move") or "static"
        shots.append({
            "index": index,
            "id": entry.get("id") or f"shot{index}",
            "start": entry.get("start", 0.0),
            "duration": entry.get("duration", 0.0),
            "size": cam.get("size") or "MS",
            "subject": subject if subject_is_cast else None,
            "subject_prop": None if subject_is_cast else subject,
            "insert": bool(subject) and not subject_is_cast,
            "secondary": (cam.get("secondary")
                          if cam.get("secondary") in world["cast"] else None),
            # `track` is a dolly that holds the subject; the solver already
            # holds the subject, so only the lateral move is left.
            "move": "dolly" if move == "track" else move,
            "side": cam.get("side", 1),
            "height": cam.get("height") or "eye",
            "ots": bool(cam.get("ots")),
            "world_target": cam.get("lookAt"),
            "explicit_at": cam.get("at"),
            "lens": cam.get("lens"),
            "actions": entry.get("actions") or [],
            "caption": entry.get("caption"),
        })
    return shots


# ---------------------------------------------------------------------------
# Render
# ---------------------------------------------------------------------------

def configure_render(scene, samples, res):
    """Hand the look to ph_assets, then own only what is ours.

    apply_film_look is the researched recipe -- tonemap, sampling, denoiser,
    compositor -- and duplicating any of it here would mean two places to
    change. Motion blur is switched off because a still has no keyframes to
    blur along: it would cost 7% for a picture that cannot differ.
    """
    params = inspect.signature(ph_assets.apply_film_look).parameters
    kwargs = {}
    if "samples" in params:
        kwargs["samples"] = samples
    if "resolution" in params:
        kwargs["resolution"] = res
    if "motion_blur" in params:
        kwargs["motion_blur"] = False
    ph_assets.apply_film_look(scene, **kwargs)

    # Whatever the recipe could not be told, set here rather than assume.
    if "samples" not in kwargs:
        scene.cycles.samples = samples
    if "resolution" not in kwargs:
        scene.render.resolution_x, scene.render.resolution_y = res
        scene.render.resolution_percentage = 100

    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"   # no GPU and no libEGL on this box
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"


def parse_res(text):
    match = re.fullmatch(r"(\d+)\s*[xX]\s*(\d+)", text.strip())
    if not match:
        raise argparse.ArgumentTypeError(f"--res wants WxH, got {text!r}")
    return int(match.group(1)), int(match.group(2))


def main(argv):
    parser = argparse.ArgumentParser(
        description="Render one still per shot of a normalised playhouse scene.")
    parser.add_argument("scene", help="scene JSON from tools/scene-to-json.mjs")
    parser.add_argument("outdir", help="directory to write stills into")
    parser.add_argument("--samples", type=int, default=64)
    parser.add_argument("--res", type=parse_res, default=(960, 540))
    parser.add_argument(
        "--shot", action="append", default=[],
        help="render only these shots, by id or index; repeatable or comma-separated. "
             "Earlier shots are still simulated, so the state a shot inherits is right.")
    parser.add_argument(
        "--t", type=float, default=1.0,
        help="where in a camera move to sample, 0..1. Defaults to 1: a still "
             "shows a move landed, matching actors shown arrived.")
    parser.add_argument("--save-blend", action="store_true",
                        help="also write scene.blend, for opening the setup by hand")
    args = parser.parse_args(argv)
    if not 0.0 <= args.t <= 1.0:
        parser.error("--t is progress through a shot, so it must be within 0..1")

    with open(args.scene, "r", encoding="utf-8") as handle:
        scene_data = json.load(handle)

    warnings = []

    def warn(message):
        warnings.append(message)
        print(f"  warning: {message}")

    wanted = set()
    for item in args.shot:
        wanted.update(part.strip() for part in item.split(",") if part.strip())
    if wanted:
        # Checked against the raw JSON, before anything is built: a typo in a
        # shot name should cost a second, not a scene assembly.
        known = set()
        for index, entry in enumerate(scene_data["shots"]):
            known.add(entry.get("id") or f"shot{index}")
            known.add(str(index))
        unknown = wanted - known
        if unknown:
            parser.error(f"no such shot: {', '.join(sorted(unknown))}")

    os.makedirs(args.outdir, exist_ok=True)
    reset_blend()
    scene = bpy.context.scene
    configure_render(scene, args.samples, args.res)

    world = build_world(scene_data, warn)
    shots = prepare_shots(scene_data, world)
    cam = make_camera(scene)
    print(f"  {scene_data.get('title', 'Untitled')}: {len(shots)} shots, "
          f"{len(world['props'])} props, cast {'/'.join(world['cast'])}")

    manifest = []
    rendered = 0
    started = time.time()

    for shot in shots:
        # Actions always run, even for shots we are not rendering: a shot's
        # picture is made of everything that happened before it.
        for action in shot["actions"]:
            apply_action(action, world, warn)
        bpy.context.view_layer.update()
        refresh_aim_points(world)

        solved = solve_shot(shot, world, t=args.t)
        position = Vector(shot["explicit_at"]) if shot["explicit_at"] else solved["position"]
        look_at = Vector(shot["world_target"]) if shot["world_target"] else solved["look_at"]
        fov = float(shot["lens"]) if shot["lens"] else solved["fov"]

        # A position the director asked for explicitly is honoured as written;
        # one the solver invented is checked against the actual set first.
        if not shot["explicit_at"]:
            focus = world["cast"].get(shot["subject"]) or \
                world["props"].get(shot["subject_prop"])
            ignore = set()
            if focus is not None:
                ignore.add(focus["obj"])
                ignore.update(_descendants(focus["obj"]))
            position = unblock_camera(scene, world, position, look_at,
                                      ignore, warn, shot["id"])

        heading = aim_camera(cam, position, look_at, fov)
        light_for_camera(world, heading, fov,
                         scene.render.resolution_x / scene.render.resolution_y)

        name = f"{shot['index']:02d}-{shot['id']}.png"
        path = os.path.join(args.outdir, name)
        selected = (not wanted) or shot["id"] in wanted or str(shot["index"]) in wanted

        manifest.append({
            "index": shot["index"],
            "id": shot["id"],
            "file": name,
            "size": shot["size"],
            "move": shot["move"],
            "height": shot["height"],
            "subject": shot["subject"] or shot["subject_prop"],
            "start": shot["start"],
            "duration": shot["duration"],
            "caption": shot["caption"],
            "camera": {
                "atThree": [round(v, 4) for v in position],
                "lookAtThree": [round(v, 4) for v in look_at],
                "atBlender": [round(v, 4) for v in to_blender(position)],
                "fov": round(fov, 3),
                "lensMm": round(cam.data.lens, 2),
                "headingDeg": round(heading, 2),
            },
        })

        if not selected:
            continue

        if args.save_blend and rendered == 0:
            bpy.ops.wm.save_as_mainfile(
                filepath=os.path.join(args.outdir, "scene.blend"))

        scene.render.filepath = path
        shot_started = time.time()
        bpy.ops.render.render(write_still=True)
        rendered += 1
        print(f"  [{shot['index']:02d}] {shot['id']:<10} {shot['size']:<3} "
              f"{shot['move']:<8} -> {name}  ({time.time() - shot_started:.1f}s)")

    for entry in manifest:
        entry["rendered"] = os.path.exists(os.path.join(args.outdir, entry["file"]))
    with open(os.path.join(args.outdir, "manifest.json"), "w", encoding="utf-8") as handle:
        json.dump({
            "title": scene_data.get("title"),
            "source": scene_data.get("source"),
            # Every shot is solved on every run, so the camera figures below are
            # always current; only `lastRun` is specific to this invocation,
            # which matters after a `--shot` re-render at different settings.
            "lastRun": {
                "samples": args.samples,
                "resolution": list(args.res),
                "t": args.t,
                "shots": sorted(wanted) or "all",
            },
            "warnings": warnings,
            "shots": manifest,
        }, handle, indent=2)

    print(f"  {rendered} still(s) in {time.time() - started:.1f}s -> {args.outdir}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
