# Questline — Project Plan & Design Document

> **Working name:** Questline
> **Course:** Django Advanced — SoftUni Regular Exam (Individual Project)
> **Roles in this project:** *You* write 100% of the code. *Claude* acts as senior mentor + documentation provider only — guidance, explanation, review, unblocking. No code is written or scaffolded for you.

---

## 1. What the app is

**Questline is a platform for building and following interactive, gamified roadmaps.**

Think roadmap.sh, but with an RPG skin and far more flexibility. Anyone can author a *Questline* — a structured adventure toward a goal — and publish it for others to follow:

> *"Do you want to become Level 80 at Cooking? Follow the Questline **Master Chef**."*
> *"Do you want to shred so hard your neighbours hate you? Accept the Questline **Menace to Society**."*

Every user plays in **two modes**:

- **Author mode ("the edit stage"):** You build a Questline as a map of **Quests** (nodes/cards). Each Quest carries author-chosen **interactive Objectives** — a checklist, a progress slider, a reflection prompt, plus description and resource links. You decide what inputs each Quest exposes.
- **Adventurer mode ("the published version"):** You discover a public Questline and **accept** it. That drops a *personal instance* into your account. You tick the author's checkboxes, drag their sliders, and write your own notes/reflections per Quest ("useful conclusions from this section of the map") — **without ever altering the original**.

### The heart of the design (the "complex case")

A clean separation between the **authored template** and each follower's **progress instance**:

```
  TEMPLATE (authored once, shareable)      PROGRESS (per adventurer, private)
  ───────────────────────────────────      ──────────────────────────────────
  Questline                                Enrollment      (user ↔ questline)
    └ Quest                                  └ ObjectiveProgress  (checkbox ticked? slider value?)
        └ Objective                          └ AdventureNote      (personal reflection per quest)
          (checklist | slider | reflection)
```

**One Questline → many adventurers, each with independent progress and reflections.** This single decision is what makes Questline more than a personal to-do list, gives us the required public/private split for free (public = the template anyone browses; private = *your* run of it), and creates the genuinely interesting Django work: template-vs-instance modeling, progress roll-ups, and "clone/remix a Questline."

---

## 2. Our goal with it

1. **Primary goal — practice Django deeply.** This is an exam project; the point is to exercise models, views, forms, templates, auth, permissions, admin customization, validation, security, and the bonus surfaces (DRF, async, deployment, testing). Questline was chosen because it stretches into genuinely complex cases (polymorphic objectives, template↔instance separation, progress roll-ups) rather than plain CRUD.
2. **Secondary goal — build something actually usable.** A roadmap tracker you'd realistically open to plan and follow your own learning/projects, and that others could share. Usefulness is a bonus, not the driver — but it's real here.
3. **Pass every hard requirement + bank as many bonuses as time allows.** See the coverage checklist in §7.

---

## 3. Domain model (with the RPG skin)

**Chosen approach for Objective flexibility: Option B — polymorphic inheritance.** An abstract `Objective` base with concrete subclasses (`ChecklistObjective`, `SliderObjective`, `ReflectionObjective`) and polymorphic render/validate. This directly trains inheritance/abstraction/polymorphism *and* banks the OOP bonus in the rubric.

### Hierarchy
```
Questline  ("Become Level 80 at Cooking")   ← the shareable adventure (template)
   └─ Quest  ("Master knife skills")          ← a node/card on the map; ordered; can require earlier quests
        └─ Objective                          ← the flexible interactive bit: checklist item, slider, or reflection prompt
```

### Template models (authored once, public)
| Model | Role | Notable fields |
|---|---|---|
| **Questline** | the adventure | title, description, category, difficulty, cover image, `author → User`, visibility (draft/published) |
| **Quest** | a node on the map | `questline → FK`, title, body (markdown), order, `prerequisite` (self-ref → unlocks path logic) |
| **Objective** *(polymorphic base)* | flexible input | `quest → FK`, subtype-specific config; subclasses: `ChecklistObjective`, `SliderObjective` (min/max), `ReflectionObjective` (prompt) |

### Progress models (per adventurer, private — the "instance")
| Model | Role | Notable fields |
|---|---|---|
| **Enrollment** | user *accepts* a Questline | `user → FK`, `questline → FK`, status (active/completed/abandoned), % complete, started_at |
| **ObjectiveProgress** | one user's state on one objective | `enrollment → FK`, `objective → FK`, value (bool / slider number), completed_at |
| **AdventureNote** | personal reflection per quest | `enrollment → FK`, `quest → FK`, body |

### Community / account models
| Model | Role |
|---|---|
| **Profile** (extends User) | bio, avatar, XP/level (gamification), auth |
| **Rating** *(or Bookmark)* | rate/save a public Questline → drives discovery + a public interaction |

**~8 independent models**, comfortably past the exam's 5. Progress **rolls up**: `ObjectiveProgress → Quest completion → Enrollment % → Profile XP`.

**Author visibility of follower progress:** private by default (a follower's progress is theirs alone). Aggregate author stats ("62% finish Quest 1") is a clean **later bonus**, not core.

### 3.1 Deep dive — the polymorphic `Objective` (the tricky part)

This is the hardest modeling decision in the project, so here's the full reasoning to reread when you get to it. The requirement: **a Quest holds an ordered list of Objectives of *mixed* types** (checklist, slider, reflection), and the app must be able to loop over them and have each one **render**, **validate**, and **evaluate its own progress** differently. That's textbook polymorphism — but Django gives you three inheritance styles, and only one fits well.

**The three Django inheritance styles:**

| Style | What it does | Fit for us |
|---|---|---|
| **Abstract base** (`class Meta: abstract=True`) | No table for the base; each subclass gets its own standalone table. No shared relation. | ❌ Bad here — you can't get one `quest.objectives` list across types; you'd need a separate FK per type and can't order them together. |
| **Multi-table inheritance (MTI)** | Base is a **real table** (has the `quest` FK, `order`, shared fields); each subclass gets its own table auto-linked 1-to-1 to the base row. | ✅ **The fit.** `quest.objectives.all()` returns base rows you can order and iterate. |
| **Proxy** | Same table, different Python behaviour only — no new fields. | ❌ We need per-type fields (slider min/max, etc.). |

**Recommendation: Multi-table inheritance (MTI).** Base `Objective` carries what's common; subclasses carry what's specific and override behaviour.

```python
# ILLUSTRATIVE SHAPE — you write the real thing.
class Objective(models.Model):
    quest = models.ForeignKey(Quest, related_name="objectives", on_delete=models.CASCADE)
    order = models.PositiveIntegerField(default=0)
    label = models.CharField(max_length=200)
    obj_type = models.CharField(max_length=20, editable=False)  # set on save; helps downcasting

    class Meta:
        ordering = ["order"]

    # --- the polymorphic interface: subclasses override these ---
    def render_widget(self):      raise NotImplementedError
    def clean_config(self):       raise NotImplementedError   # validate author's setup
    def is_complete(self, value): raise NotImplementedError   # given an ObjectiveProgress value

class ChecklistObjective(Objective):
    # inherits quest/order/label via the auto 1-to-1 link
    def is_complete(self, value): return bool(value)          # value = checked?

class SliderObjective(Objective):
    min_value = models.IntegerField(default=0)
    max_value = models.IntegerField(default=100)
    target    = models.IntegerField(default=100)
    def is_complete(self, value): return (value or 0) >= self.target

class ReflectionObjective(Objective):
    prompt = models.TextField()
    def is_complete(self, value): return bool(value and value.strip())
```

**The one gotcha — "downcasting."** When you query the base (`quest.objectives.all()`), Django hands you **base `Objective` rows**, *not* the `SliderObjective`/etc. subclass — so calling `.render_widget()` won't reach the override. You have two ways to resolve the real subclass:

1. **Manual (teaches more, no dependency):** store `obj_type` on save, then add a helper like `def concrete(self): return getattr(self, self.obj_type)` (Django exposes the reverse 1-to-1 as a lowercased attribute, e.g. `objective.sliderobjective`). Loop as `for o in quest.objectives.all(): o.concrete().render_widget()`.
2. **`django-polymorphic` (batteries-included):** subclass `PolymorphicModel` and `quest.objectives.all()` returns the correct subclasses automatically. Cleaner, but hides the mechanism — and for an exam, showing you *understand* the downcasting yourself (option 1) is often worth more marks. **Recommended: do it manually first.**

**Where the polymorphism actually pays off (this is what scores the OOP bonus):**
- **Rendering** — each subclass renders its own widget/template; the play view just loops and calls one method.
- **Validation** — each subclass validates its own author config (`clean_config`) and each has its **own `ModelForm`** in the builder.
- **Progress** — `ObjectiveProgress` stores a single generic `value`; each subclass interprets it via `is_complete(value)`. Keep `value` simple (e.g. a `CharField`/JSON holding "true", a number, or text) and let the subclass parse it.

**Roll-up flows through this cleanly:** a Quest is complete when all its objectives report `is_complete(their progress value)` → Enrollment % = completed quests / total → Profile XP. All driven by the polymorphic method, no `if obj_type == ...` chains.

**Practical gotchas to remember:**
- MTI adds a JOIN per subclass fetch — fine at this scale, just know it's there.
- Deleting a Quest should cascade to base + subclass rows (default with `on_delete=CASCADE`).
- Order the mixed list via the base `order` field, not per-type.
- Adding a new objective type later = one new subclass + one new form + one template partial. That extensibility *is* the payoff — call it out in your defense.

**When you reach build-order step 3, bring your model draft here before migrating** — we'll pressure-test the downcasting and form wiring together.

---

## 4. Pages, views, forms, roles (rubric mapping)

### Pages & views (need 10+, with 5+ class-based — we plan ~14, mostly CBV)

**Public (GET-only for guests):**
1. Landing / home — `TemplateView`
2. **Explore Questlines** — `ListView` (search + filter by category/difficulty) — *CBV*
3. **Questline detail** (public preview of the map) — `DetailView` — *CBV*
4. Author public profile — `DetailView` — *CBV*
5. About — `TemplateView`
6. Register — `CreateView` — *CBV*
7. Login · 8. Logout — Django auth views

**Private (auth required, ownership-enforced):**
9. **Create Questline** — `CreateView` — *CBV*
10. **Builder / edit** (manage Quests + polymorphic Objectives) — `UpdateView` + nested forms — *CBV*
11. Delete Questline — `DeleteView` — *CBV*
12. **Accept Questline** → creates an Enrollment (POST)
13. **My Adventures** dashboard (authored + accepted) — `ListView` — *CBV*
14. **Play/track view** — the interactive run: tick objectives, drag sliders, write AdventureNotes
15. Edit profile — `UpdateView` — *CBV* · Rate/bookmark (POST)

### Forms (need 5+, we plan ~8)
Register (extends `UserCreationForm`), Questline, Quest, **polymorphic Objective forms** (one per subtype), AdventureNote, Profile, Rating, progress-update.

### Roles & permissions
- **Guest** → GET public pages only; POST only for login/register.
- **Authenticated** → full CRUD on *their own* Questlines, enrollments, notes, profile. Enforced via `LoginRequiredMixin` + `UserPassesTestMixin` (can't touch others' content — blocks parameter tampering).
- **Two admin groups** (required split, via Django Groups):
  - **Superuser** → full CRUD over everything.
  - **Moderator (staff)** → limited: unpublish/flag Questlines, manage categories; *cannot* delete users or change roles. Role management handled safely from the admin.

### Customized admin (need 5+ options)
`list_display`, `list_filter` (category/difficulty/visibility), `search_fields`, `ordering`, **inlines** (Quests inside Questline, Objectives inside Quest), custom **actions** ("Publish"/"Unpublish"), `fieldsets`.

---

## 5. Bonus strategy, stack, and safety

### Bonus plan (exam gives up to +15%)
- **DRF REST API** — expose Questlines + a user's progress as JSON. This is the seam a phone app / reminder bot reads & updates.
- **Async view** — when an author adds **resource links** to a Quest, an async view **fetches their titles/favicons concurrently** (a real reason to be async, not bolted on).
- **Extended user** — custom user (email login) + `Profile` with XP/level.
- **Deployment** — Docker + `docker-compose`, PostgreSQL, `whitenoise` + `gunicorn`.
- **Testing (10+)** — unit (model roll-up logic, polymorphic Objective validation) + integration (accept-questline flow, ownership/permission checks).
- **Extra functionality** — gamification (XP/levels), **clone/remix** a public Questline into your own to edit, ratings/bookmarks.
- **Stretch (optional):** email reminders for stale enrollments ("no progress on *Menace to Society* in 7 days") via a management command — clean use of the progress data.

### Tech stack
Django 6.0 · **SQLite** (dev) / **PostgreSQL** (prod) · **DRF** · **Bootstrap 5** (responsive requirement) · **Pillow** (cover images) · `python-decouple` (env) · `whitenoise` + `gunicorn` + Docker (deploy).

### Validation & security (rubric points)
- **Server-side:** model `validators` + form `clean()` (slider min/max, required fields, markdown length). **Client-side:** HTML5 + light JS.
- **Security:** ORM (SQL-injection safe), template autoescaping + **markdown sanitization** (XSS), CSRF on all POST, **ownership filtering in `get_queryset` + `UserPassesTestMixin`** (parameter tampering).
- **Exception handling:** custom 403/404/500 pages, `try/except` around async external fetches, user-facing messages via Django's `messages` framework.

---

## 6. Suggested app layout

Keep units small and focused (mirrors the reference project's structure):

- `accounts` — custom user + `Profile`, auth (register/login/logout), profile pages.
- `questlines` — `Questline`, `Quest`, polymorphic `Objective` models, the builder/edit views, explore/detail.
- `adventures` — `Enrollment`, `ObjectiveProgress`, `AdventureNote`, the accept + play/track flow, roll-up logic.
- `community` — `Rating`/`Bookmark`, discovery helpers.
- `api` — DRF endpoints (bonus).
- `common` — landing/about pages, shared mixins, custom error handlers.

---

## 7. Requirements coverage checklist

| Exam requirement | Covered by |
|---|---|
| 10+ pages | ~14 pages (§4) |
| 5+ class-based views | ~10 CBVs (§4) |
| 5+ independent models | 8 models (§3) |
| 5+ forms | ~8 forms (§4) |
| 5+ templates | landing, explore, detail, builder, play, profile, about… |
| Login / register / logout | Django auth + custom register (§4) |
| Public part | landing, explore, questline detail, profiles, about |
| Private part | builder, my adventures, play/track, profile edit |
| Customized admin (5+ options) | list_display, list_filter, search, ordering, inlines, actions, fieldsets (§4) |
| 2 admin groups | Superuser + Moderator (§4) |
| Guest GET-only / login-register POST | permission model (§4) |
| Authenticated full CRUD on own content | ownership mixins (§4) |
| Exception handling & validation (client + server) | §5 |
| Security (SQLi, XSS, CSRF, tampering) | §5 |
| Responsive design | Bootstrap 5 |
| Git (3+ commits on 3+ days) | `git init` the project early; commit in stages |

### Bonuses targeted
Testing (10+) · Async view · DRF · Extended user · Deployment · Gamification / clone-remix / ratings.

---

## 8. Suggested build order (mentor guidance)

A sane sequence so nothing blocks you. Commit at each stage (helps the 3-commits-on-3-days requirement):

1. **Foundations** — `git init`, project + apps skeleton, custom user + `Profile`, base template + Bootstrap, landing/about.
2. **Authoring core** — `Questline` + `Quest` models & CRUD (create/builder/edit/delete), explore + detail (public).
3. **Polymorphic Objectives** — the abstract base + 3 subclasses, their forms, rendering in the builder. *(The trickiest part — expect to iterate.)*
4. **Adventurer flow** — `Enrollment` (accept), the play/track view, `ObjectiveProgress`, `AdventureNote`, progress roll-up + XP.
5. **Community + admin** — ratings/bookmarks, customized admin, the two admin groups.
6. **Hardening** — validation, security passes, custom error pages, exception handling, messages.
7. **Bonuses** — tests, DRF, async link-preview, deployment, stretch reminders.

---

*This document is the single source of truth for the design. Update it as decisions evolve. When you hit something unclear or want a section explained/reviewed, bring it here and we'll work through it together.*
