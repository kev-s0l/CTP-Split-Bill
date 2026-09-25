# Team Charter

*C12 Fall 2026 · Week 3's homework · written as a team after kickoff
(section 4 while the migration review is fresh) · merged into your team
repo by the Week-4 session · revisit at midterm. Worked example: [charter-example.md](charter-example.md) · how-to:
[charter-guide.md](charter-guide.md).*

## 1 · Team & Project

**Team name:** Split Bill

**Project (adopted pitch):** Split Bill

**Section:** Fri 3:00 

**Members:**

| Name           | GitHub | Email |
|Kevin Bermejo   |kev-s0l   ||
|Keyshawn Seymour|KeySeymour|kseymour@live.com|
|Eric Gardiner   |        |       |
|Sahla Taher     |        |       |
|Andrew Jiang    |ajiangny|andrewjiang74@gmail.com|

### Roles & responsibilities

**Rotating roles (who has it this week is posted in the channel):**
Roles rotate weekly so nobody becomes "the one who always…". The stand-up lead runs Friday's 15 minutes and posts the notes. The review captain is first responder on every PR opened that week (others can still review — the captain just guarantees nobody waits). The demo owner keeps main deployable and runs the team's status share when it's our turn. Rotation is in the team channel's pinned message; whoever has it, has it — no swapping without a message.

**Standing ownership:** Each member is the first stop for questions in their aspect. First stop, not sole owner — anyone can change anything, but you ask the expert before you rewrite their layer.

**Everyone, every week:** One homework PR merged, one review given, stand-up attended or an async update posted before it.

## 2 · The Product

*Pull this from your adopted pitch, then sharpen it as a team — this is
refinement, not re-ideation.*

**The problem:** Helping large dinner groups split up their meal bills while keeping an accountability system for payment amongst users.

**Who it's for:** Anyone dining in a restaraunt as a group.

**Three core features (the MVP):**

1. AI Reciept Scanner
2. Party Split Payment Accountability System
3. Late Payment Notification System

**What ships by Week 13 (demo day):** A stranger opens our URL, creates an account, scans an example reciept, creates a party to split the bill, invites users to their party, the bill is split amongst those users.
**Out of scope / v2 ideas (Week-9 pitch fodder):** in-app money transfers, mobile app, restaraunt bill processing through app

## 3 · Working Agreement

**Where we talk:** Slack 

**Response window:** Within 24 hours of a post being made

**When we meet (outside class):** If there's any need to meet in-person outside of class the meeting will be scheduled at least 2 days prior and re-confirmed at least the night before. 

**Availability notes:** Schedules shared on slack channel. If there's any change prior to the new week starting it's to be brought up at the coming stand-up.

**How we decide when we disagree:** If a disagreement arrives we will take a vote as a group and majority rules will prevail (At least 3/5 members agree)

**Definition of done:** Able to merge to main, green CI, reviewed by someone who pulled and ran it, and it works at the preview URL.

### Rituals

| Ritual | When | Shape |
|--------|------|-------|
| Stand-up | Friday 5:30pm, 15 min | Each person: merged / in review / blocked. Every blocker leaves with an owner|
| Team review (in class) | Every session, ~15 min | One PR on screen; the four moves (pull, run, read, ask one real question); Comments filed as real review comments.|
| Async check-in | Flexible | One line each: what's in flight, anything slipping. Replaces a meeting not a converstaion |
| Retro | Midterm (week 7) + before demo day | 20 minutes: Keep / stop / start. The charter gets edited on the spot, that's the output. |
| Planning | Sunday night, async, 10 min | Next week's PRs claimed by name, one issue each. If you can't name your PR on Sunday, that's the first thing to say at stand-up. |

**How we track work:** Github Issues, Project Board

## 4 · Code & Review Norms

*Complete this section together in Week 3, at code kickoff.*

**Branch & PR flow:** main is protected. Branch from main as yourname/short-thing, open a PR early (draft is fine), request the review captain plus one. Squash-merge; the PR title is the commit message, so write it like one.

**What blocks approval:** the reviewer couldn't run it; a query that isn't scoped by the current user; a migration that edits an earlier migration instead of adding a new one; AI-generated code the author can't explain when asked. Style never blocks — leave a nit: and approve.

**Review response time:** first response within 48 hours on weekdays. If you can't review in time, say so in the PR so the captain reroutes it — silence is the only unacceptable answer.

**Comment conventions:** : nit: (take it or leave it) · q: (a real question — answer before merge) · blocker: (must change) · praise: (say what's good; it's how we learn what to repeat). One blocker: per real problem, not a wall of them

## 5 · AI Working Norms

**Course policy (not optional):** no AI-generated code gets merged unread. The PR author owns every line they open, wherever it came from. AI explanations get verified by running the code.

**How we use AI as a team:** Individually we will use AI to create however, all features that've been generated by AI will need to be specified in comments of PR.

**What we never delegate to AI:** the schema and migrations (hand-typed, per kickoff), anything touching user scoping, and the review itself — a reviewer reads the diff, not a summary of it.

## 6 · When Things Go Wrong

**Stuck protocol (course default):** 15 minutes stuck → post in the team thread → still stuck at stand-up → TA → office hours.

**If someone can't deliver on time:** They must notify with at least 2 days notice that they won't be able to deliver. Any tasks that need to be done would be delegated to whoever volunteers to take on the work. The PR moves to the following week.

**If we have a conflict:** Name it during the standup, or bring up your grievance in the slack channel prior to the standup happening. If it's still an issue than we will speak with Elie to mediate. In cases of product direction we will come to a team vote and if no decision can be decided then it will come down to Kevin's direction as the pitcher.

## 7 · Commitment

We wrote this together, we mean it, and we'll revisit it at midterm and
update what isn't working.

| Signed | Date |
|Keyshawn Seymour|9/24/26|
|Eric Gardiner  | 9/24/26|
|        |      |
|        |      |
|        |      |
