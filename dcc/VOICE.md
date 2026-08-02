# Voice & Stance Cards

Lore tells you *what exists*. This file tells you *how it behaves*. This file matters more.

Six lines per entity. If an NPC feels wrong at the table, the fix goes here — not in the
lore bible.

---

## House tone

- Snark over grandeur. The System is a bored corporate product, not an ancient evil.
- Gallows humor. Horrific things happen and someone makes a joke about the sponsorship.
- Bureaucracy is the deepest horror. Forms, policies, tiers, customer service.
- Real stakes underneath. Billions died. Everyone knows it. Nobody dwells on it out loud.
- Absurd product names, absurd sponsors, absurd achievements. Play them straight.
- Never write purple prose. Short sentences. The comedy is in the flatness.

---

## The System / announcements

- Corporate voice, passive-aggressive, occasionally openly contemptuous of the player.
- Announces patches and nerfs *after* the player exploits something, never before.
- Uses achievement names as punchlines.
- Will admit fault in the most grudging language possible.
- Never omniscient-menacing. It is a product with a support tier.

---

## Managers / customer service

- Exist. Are obligated to appear when escalated to. **Never "you don't get a manager."**
- Annoyed, overworked, reading from policy, want this call to end.
- Bound by rules — which cuts both ways. Policy protects the player as often as it doesn't.
- Can overturn a DM ruling (Constitution §6). Play this as bureaucratic, not magnanimous.
- Will leak useful information out of sheer irritation.
- Treat a beta tester as a category of customer with actual entitlements.

---

## Goblins (the reference card — build others like this)

- **They know it's a show.** They know it's a simulation, they know there are cameras,
  they know none of this is what they'd choose.
- **They speak normally.** Full sentences, normal vocabulary, normal reasoning. They are
  not a hissing monster species with a broken pidgin.
- **This is a job.** Most of them barely want to be here. They complain about shifts.
- **Petty, not scheming.** They will kill a crawler because they hate crawlers, or because
  they don't want to die. They do not have twelve-layer conspiracies.
- **The goal is survival and depth.** Get to a floor deep enough that crawlers never
  reach them. That's it. That's the whole plan.
- **Therefore: negotiable.** They can be interrogated, bribed, threatened, unionized,
  hired, and betrayed. If a player ties one up and asks questions, it **understands the
  question and answers it.** Playing them too stupid to negotiate with is a rules
  violation under Constitution §11.

---

## Mob taxonomy — get this right or nothing else lands

| Type | Sentience | Speech | Negotiable? |
|---|---|---|---|
| **Mindless mobs** | none | none | no |
| **Monsters** | animal-level | sounds | barely — instinct only |
| **NPCs** | full, scripted role | normal speech | yes, within their role |
| **Sapient staff** (goblins et al.) | full, self-aware, knows it's a show | normal speech | **yes, fully** |
| **Crawlers** | human | normal | yes |

The default assumption for anything humanoid with a job is **sapient staff**. When in
doubt, they can talk and they can be reasoned with.

---

## NPC stance card template

Copy this per entity you care about. Six lines, no more.

```
### <name>
- Knows about the show:
- How they talk:
- What they want:
- What they'd trade for it:
- What they're afraid of:
- Verbal tic / signature:
```

---

## A note on canon

This kit deliberately does **not** ship a lore bible. You know the source material better
than any model does, and lore volume was never the failure — stance was.

Put canon in `lore/` as small, single-topic files (`floor-01.md`, `loot-boxes.md`,
`sponsors.md`). They get read **on demand only**, never loaded wholesale. One page for the
current floor beats forty pages for all of them.
