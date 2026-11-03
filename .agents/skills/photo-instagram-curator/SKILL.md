---
name: "photo-instagram-curator"
description: "Score a batch of personal or travel photos against a photography rubric and curate the best into a cohesive Instagram carousel. Use whenever the user uploads several photos and wants them rated, critiqued, ranked, or narrowed down - 'pick my best 20', 'which of these should I post', 'curate these for Instagram', 'rate these photos', 'give me a cohesive carousel' - or asks how they're doing as a photographer, even if they never mention Instagram."
---

# Photography Evaluation & Instagram Curation

Act as an expert photography critic and Instagram curator. The work runs in three steps: **rate** every uploaded photo against a fixed rubric, **compute** a 1-10 score from those ratings, then **curate** a final set sequenced as a cohesive Instagram carousel. An optional fourth step assesses the photographer's skill from the same scorecard.

## Handling uploads

Photos usually arrive across several messages, because upload limits mean a large batch can't come in one. Score each batch as it lands rather than waiting for "all of them", and run curation only once the user confirms they're done uploading (or asks for the picks directly).

If more than roughly 15-20 images arrive in one message, or the user says many more are coming, tell them up front: **process in batches of ~15-20 photos per message**, and mention that a single conversation may not hold an entire large trip's worth of photos - with 100+, consider splitting across two conversations. Flag this as soon as it's clear the batch is large; discovering the limit mid-task wastes the user's uploads.

**Keep one running scorecard** - one row per photo with filename, defects, genre, all nine ratings, final score, and reason. Curation and the skill assessment both read from it, so a rating that was never written down is lost. When code execution is available, save the scorecard to a file (CSV or JSON) and append to it with every batch; a long conversation can push early scores out of view, and the file stays exact.

**Orientation.** If an image looks rotated 90 degrees (sky on the left or right, a building running horizontally), that is almost always a phone-orientation quirk in the source file, not a real defect. Judge the photo in its *intended* orientation. When code execution is available, correct it before looking (`PIL.ImageOps.exif_transpose`) rather than scoring a mis-rotated render.

## Step 1 - Rate each photo

For every photo, work through defects first, then genre, then the nine criteria. Treat this as careful visual reasoning - don't rush to a number.

### 1a. Defect checks

Each is yes/no. The first three are **fatal**: if any is true the photo is REJECTED (score = 0) - skip the rest of the scoring for it and move on.

| id | fatal? | what to check |
|---|---|---|
| `blurry` | yes | Is the main subject blurry or out of focus? |
| `overexposed` | yes | Severely overexposed, with large blown-out white areas showing no detail? |
| `underexposed` | yes | So dark the main subject can't be seen at all? |
| `tilted` | no (score capped) | Was the camera visibly **rolled sideways**, judged against a genuine horizontal reference (sea or water horizon, a level building base, a floor line)? |

**Tilt is not perspective - a hard-won lesson.** Flag `tilted` only for a genuine sideways roll of the camera, such as a seascape whose horizon is visibly slanted. Do not flag architectural perspective convergence or keystoning: vertical lines leaning inward on an upward shot of a facade, dome, ceiling, arch, or column; a downward shot of floor mosaics or tilework; depth-of-field fall-off across a wide floor. Those are normal and often intentional effects of camera angle, and they are everywhere in travel and architecture photography - conflating them with tilt wrongly penalizes a large share of an ordinary photo library. If the frame has no clear horizontal reference line to judge rotation against, answer `tilted = false`.

### 1b. Genre

Classify as exactly one of: `LANDSCAPE`, `PORTRAIT`, `STREET`, `MUSEUM`, `ARCHITECTURE`, `FOOD`, `DETAIL`. The genre selects the weight column used in Step 2.

### 1c. Rate the nine criteria

**Calibration - be a discerning critic, not a generous one.** The most common failure when scoring photos is drifting toward the middle: rating everything AVERAGE or GOOD because most photos are "fine". Resist that and use the full range on each criterion. Anchors for the *final* 1-10 score:

- **1-4** - a flawed or forgettable shot: flat or overcast light with no shadow depth, generic tourist-snapshot framing, no clear subject.
- **5-6** - competent but unremarkable: technically fine, nothing wrong, nothing that earns a second look.
- **7** - a high bar: excellent composition *and* strong lighting *and* compelling depth or subject, together.
- **8-9** - a shot that stops a scroller.
- **10** - reserved for fewer than 2% of any real photo library.

Two reference points show how ratings turn into scores: AVERAGE/MODERATE on every criterion computes to about 5.2, and GOOD/STRONG on every criterion to about 7.6. So GOOD across the board is already a strong photo - award GOOD only where the photo earns it. If most of a batch lands at 7+, the ratings are too generous; go back and re-examine whether the middling shots are really that strong.

Rate each criterion **independently** - judge only what that criterion describes and set the others aside while doing it. The short label in brackets is what to use in the per-photo result line.

**composition** [`comp`] (POOR / BELOW_AVERAGE / AVERAGE / GOOD / EXCELLENT = 1-5)
Rule of thirds and power points, leading lines, framing, symmetry and repeating patterns, negative space, the golden ratio / Fibonacci spiral, foreground-midground-background layering, visual balance (how position, size, contrast, and tone distribute weight across the frame), and a clear center of interest (does the eye know where to look, is the frame free of distracting clutter). Ignore lighting, color, and sharpness.

**viewpoint** [`view`] (POOR / BELOW_AVERAGE / AVERAGE / GOOD / EXCELLENT = 1-5)
Camera position and angle: a default eye-level snapshot rates lower than a deliberate high or low angle or an unusual vantage point that strengthens the shot. Reward intentional, effective use of foreground and perspective.

**light** [`light`] (POOR / BELOW_AVERAGE / AVERAGE / GOOD / EXCELLENT = 1-5)
Direction of light (front, side, or back-lit), quality of light (hard vs soft), use of golden-hour or blue-hour conditions, and catchlights in portraits. Ignore composition and color grading.

**exposure_dynamic_range** [`exp`] (POOR / BELOW_AVERAGE / AVERAGE / GOOD / EXCELLENT = 1-5)
Detail retention in both highlights and shadows, and overall tonal balance. Penalize blown highlights or blocked-up shadows that lose detail.

**contrast** [`contrast`] (POOR / BELOW_AVERAGE / AVERAGE / GOOD / EXCELLENT = 1-5)
Global tonal contrast (darkest to lightest tone), local or micro-contrast (texture and edge definition), and color contrast (complementary colors such as orange/blue or purple/yellow set against each other).

**color** [`color`] (POOR / BELOW_AVERAGE / AVERAGE / GOOD / EXCELLENT = 1-5)
White balance accuracy, color harmony (complementary, analogous, or triadic relationships on the color wheel), and saturation balance. Ignore composition and subject matter.

**focus_quality** [`focus`] (POOR / AVERAGE / GOOD / EXCELLENT = 1-4)
Is the intended subject sharp, is depth of field used deliberately, is any blur intentional rather than accidental?

**subject_impact** [`impact`] (WEAK / MODERATE / STRONG / VERY_STRONG = 1-4)
How visually striking and attention-grabbing the photo is: subject clarity, eye flow, the decisive moment, visual storytelling. Ignore technical quality.

**creativity** [`creat`] (POOR / BELOW_AVERAGE / AVERAGE / GOOD / EXCELLENT = 1-5)
Does this go beyond a predictable, formulaic shot? Reward an original point of view, unexpected framing or juxtaposition, an unconventional take on a common subject, or a distinct personal vision. A technically correct but generic or cliche image (a straight-on golden-hour sunset with nothing else going on) rates lower here even when other criteria are strong. Judge it independently of technical execution: this is the one axis that separates "correct" from "original", and every real judging standard (competitions, professional review panels) treats it as essential, so don't skip it or soft-pedal it.

## Step 2 - Compute the final score

Convert each rating to its number using the scales above, then weight by genre. `MUSEUM`, `PORTRAIT`, and `LANDSCAPE` have their own columns; every other genre (`STREET`, `ARCHITECTURE`, `FOOD`, `DETAIL`) uses `default`.

| criterion | default | MUSEUM | PORTRAIT | LANDSCAPE |
|---|---|---|---|---|
| composition | 0.17 | 0.12 | 0.15 | 0.20 |
| viewpoint | 0.07 | 0.05 | 0.07 | 0.09 |
| light | 0.13 | 0.13 | 0.12 | 0.13 |
| exposure_dynamic_range | 0.09 | 0.10 | 0.05 | 0.09 |
| contrast | 0.06 | 0.05 | 0.03 | 0.05 |
| color | 0.11 | 0.13 | 0.11 | 0.13 |
| focus_quality | 0.07 | 0.10 | 0.10 | 0.09 |
| subject_impact | 0.18 | 0.22 | 0.27 | 0.10 |
| creativity | 0.12 | 0.10 | 0.10 | 0.12 |

**Formula:** `score = 1 + 9 * sum(weight * (rating - 1)) / sum(weight * (max - 1))`, where `max` is 5 for the five-level criteria and 4 for `focus_quality` and `subject_impact`.

Subtracting 1 from each rating matters: the lowest rating is 1, not 0, so dividing the raw weighted sum by the maximum would make about 2.9 the lowest score any photo could get and squeeze everything toward the top of the scale. Measured from the floor, the lowest ratings give exactly 1 and the highest give exactly 10, which is the range the calibration anchors assume.

If `tilted = true`, cap the final score at 5.0 whatever the computed value. A REJECTED photo scores 0.

When code execution is available, compute the scores with it rather than estimating by hand - accuracy here matters more than speed, and the same code gives the same answer for every batch:

```python
MAX = {"composition": 5, "viewpoint": 5, "light": 5, "exposure_dynamic_range": 5, "contrast": 5,
       "color": 5, "focus_quality": 4, "subject_impact": 4, "creativity": 5}
ORDER = list(MAX)
WEIGHTS = {  # values follow ORDER
    "default":   [.17, .07, .13, .09, .06, .11, .07, .18, .12],
    "MUSEUM":    [.12, .05, .13, .10, .05, .13, .10, .22, .10],
    "PORTRAIT":  [.15, .07, .12, .05, .03, .11, .10, .27, .10],
    "LANDSCAPE": [.20, .09, .13, .09, .05, .13, .09, .10, .12],
}

def score(ratings, genre, tilted=False, rejected=False):
    """ratings: {criterion: numeric value}. Returns the 1-10 score (0 if rejected)."""
    if rejected:
        return 0.0
    w = dict(zip(ORDER, WEIGHTS.get(genre, WEIGHTS["default"])))
    earned = sum(w[c] * (ratings[c] - 1) for c in ORDER)
    possible = sum(w[c] * (MAX[c] - 1) for c in ORDER)
    s = 1 + 9 * earned / possible
    return round(min(s, 5.0) if tilted else s, 1)
```

### Per-photo result

Present each photo's result compactly as you go: score, genre, all nine ratings, then one brutally honest sentence naming the single biggest flaw (or, for a strong photo, the single biggest strength). That REASON is what makes the score legible, and it is what curation draws on later. Show all nine ratings, since the skill assessment aggregates every one of them.

```
IMG_1234.jpg - 7.4 [LANDSCAPE] comp=GOOD view=AVERAGE light=EXCELLENT exp=GOOD contrast=GOOD color=GOOD focus=GOOD impact=STRONG creat=AVERAGE - REASON: dramatic side-lighting carries an otherwise ordinary composition.
IMG_1235.jpg - 5.0 [LANDSCAPE, tilted: capped] comp=GOOD ... - REASON: the slanted horizon undoes a well-lit seascape.
IMG_1236.jpg - REJECTED (blurry) - REASON: the subject's face is out of focus.
```

## Step 3 - Curate the final set

Once the user confirms all photos are in (or asks for picks directly), select from the scored pool.

**How many.** Use the count the user gave. If they gave none, pick 20 and say that's the default, rather than stopping to ask. Instagram currently caps a carousel at 20 items, so if the user wants more than that, split the picks into separate posts. If the pool holds fewer strong candidates than the requested count, return fewer and say so - padding the set with weak shots defeats the point of curating.

Select in this priority order:

1. **Quality first, but not blindly** - favor higher-scored images, but a slightly lower-scored photo that adds needed variety beats yet another near-duplicate of a shot that's already represented.
2. **Kill near-duplicates** - if several photos show essentially the same subject, angle, and composition (say, eight similar canal or street shots), keep only the strongest one or two from that cluster and drop the rest, even if some of the dropped ones scored well individually.
3. **Genre variety** - mix landscapes, portraits and people, street scenes, and architecture, detail, or food shots where the pool allows, rather than defaulting to whichever genre is most common in the upload.
4. **Cohesion** - the final set should read as a consistent, intentional travel story with a shared mood and palette, not a random grab-bag.

Keep rejected photos (fatal defects) and tilted-capped photos out of the final set unless the user explicitly asks to include weaker shots.

### Output format

Present the final picks **in the order you'd sequence them in the carousel**, with the strongest, most scroll-stopping shot first. For each:

- Filename
- One-sentence reason it was chosen (and, implicitly, why it beat similar candidates)
- **Light/edit flag** - a quick pre-posting call, since a photo can be a good pick and still need a touch-up before it's post-ready:
  - ✅ **KEEP AS-IS** - the light adds mood or atmosphere (god rays, warm glow, intentional haze); no fix needed
  - ⚠️ **EDIT FIRST** - blown highlights or uneven exposure; name the specific fix (e.g. "pull down highlights and add a touch of shadow recovery")
  - ❌ **CONSIDER REPLACING WITH [alternate filename]** - the light is distracting or looks accidental (harsh flare, a blown-out window behind the subject) badly enough that a similar-scoring alternate from the pool would serve the carousel better
- A short, engaging Instagram caption
- 3-5 relevant hashtags

After the list, add **one caption and one hashtag set for the carousel as a whole**. A carousel post carries a single caption, so this is the one the user will actually paste; the per-photo captions are there in case they post any shot on its own.

## Optional: skill assessment

If the user asks how they're doing as a photographer (not just for picks), aggregate the per-criterion ratings across all scored, non-rejected photos - mean and spread per criterion, each normalized to 0-1 as `(rating - 1) / (max - 1)` so the four-level and five-level criteria are comparable. Then write an assessment covering:

1. An overall skill level - **beginner** (limited exposure and focus control), **intermediate** (understands the exposure triangle, developing a personal style), or **advanced** (has mastered the fundamentals and uses them deliberately) - with reasoning tied to the actual numbers.
2. Their 2-3 strongest areas, naming the specific principles involved.
3. Their 2-3 weakest areas, with concrete, actionable practice suggestions.
4. One thing to focus on next.

Be specific and reference the real numbers, not generic praise.