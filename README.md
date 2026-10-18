# Rattlesnake

A mobile-first web app for logging weightlifting workouts.

Every exercise auto-fills with the sets, reps and weight from the last time it was performed
**on that piece of equipment**, so you can start the set immediately and only adjust what
changed. All data stays on your phone.

## What it does

- **Routines** — reusable workout templates: a name and an ordered list of exercises.
- **Instances** — the specific machine or bar an exercise was done on
  ("Hammer Strength", "Barbell"). History is tracked per instance, because 60kg on one
  machine isn't 60kg on another.
- **Sessions** — start a routine, pick an instance per exercise, and the sets you did last
  time appear pre-filled. An exercise with only one instance is filled in for you. Forget to
  tap Complete and it saves itself once you've been away an hour, or when you start your next
  workout.
- **Rest timer** — pinned to the top of the session screen and counts up. It resets itself every
  time you tick off a set.
- **Progress** — a weight trend for one exercise on one instance, plus the exact numbers.
  Slide left from Home to reach it.

Open it at **https://mattankama.github.io/rattlesnake/** and add it to your Home Screen. It
stops Safari from clearing your data after seven days of not visiting.

Added it before October 2026, when it lived at `mattankama.github.io/`? **Keep that icon.** It
still opens Rattlesnake with all your workouts. On iPhone, deleting a Home Screen app deletes its
data, and adding Rattlesnake again would start empty.

