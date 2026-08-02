# VANGUARD — Superhero Squad Simulator

This repository also hosts **VANGUARD**, a browser-based superhero action game:
five heroes, one open procedural city, a tier-6 arch nemesis, and a side-on
versus mode with 3D fighters. It runs on a phone, installs to the home screen,
and plays offline.

- **Play / landing page** — [`index.html`](./index.html) (the site root)
- **The game itself** — [`superhero-sim/`](./superhero-sim/)
- **Docs** — [`superhero-sim/README.md`](./superhero-sim/README.md)

Once GitHub Pages is enabled for this repository it is live at
`https://crus8r.github.io/Aimbot-Script/`.

---

# Aimbot Script

## New Version

🔥NEW🔥 - This script is outdated, buggy, unsecure, unorganized and old. Check out the new version [here](https://github.com/Exunys/Aimbot-V2).

- *Note*: I, Exunys, have received a lot of feedback about this Aimbot project and by analyzing that a lot of people use this script, I have decided to rewrite this project entirely and implement my modern system for storing, optimizing and tracking. The new project is the perfect aimbot script with a very simple system. I hopefully have fixed every con about this project in the new script. Please check it out, read the repository's README.md document and use that version instead of this one.

**https://github.com/Exunys/Aimbot-V2**

## Old Version

### About

This script works on all games (unless the character is not in workspace)
Feel free to edit any of the global settings inside the script.
Editable settings :
- Aimbot Enabled / Disabled
- Aim Body Part
- Sensitivity / Aim Speed

This script also has FOV customization, circle color, circle filled, circle thickness, circle radius (fov or size), circle position and how many sides does the circle have (set to 64 for a circle, anything below 3 won't work)

### Adjustable settings for both of the Scripts

```lua
--// Aimbot

_G.AimbotEnabled = true -- Determines whether or not the Aimbot script will lock onto players.
_G.TeamCheck = false -- If set to true then the script would only lock your aim at enemy team members.
_G.AimPart = "Head" -- What body part of the closest enemy the aimbot script would lock at.
_G.Sensitivity = 0 -- How many seconds it takes for the aimbot script to officially lock onto the target's aimpart.
```

### Settings (For the script with the FOV Circle)

```lua
--// FOV Circle

_G.CircleSides = 64 -- How many sides the FOV circle would have.
_G.CircleColor = Color3.fromRGB(255, 255, 255) -- (RGB) Color that the FOV circle would appear as.
_G.CircleTransparency = 0.7 -- Transparency of the circle.
_G.CircleRadius = 80 -- The radius of the circle / FOV.
_G.CircleFilled = false -- Determines whether or not the circle area will be filled.
_G.CircleVisible = true -- Determines whether or not the circle will be visible.
_G.CircleThickness = 0 -- The thickness of the circle.
```

## Script (With FOV Circle)

Load the script by using the code below or by copying it from [here](https://github.com/Exunys/Aimbot-Script/blob/main/Aimbot%20Script.lua).
```lua
loadstring(game:HttpGet("https://pastebin.com/raw/ygp8Enye"))()
```

## Script (Without FOV Circle)

Load the script by using the code below or by copying it from [here](https://github.com/Exunys/Aimbot-Script/blob/main/Aimbot%20Script%20(Without%20FOV).lua).
```lua
loadstring(game:HttpGet("https://pastebin.com/raw/CwQcEnEd"))()
```

## Contact Information

- Discord : [Exunys](https://discord.com/users/611111398818316309)
- ROBLOX : [Exunys](https://www.roblox.com/users/330279990/profile)
