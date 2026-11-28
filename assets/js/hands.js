// Hands for the Keys picture (a man's hands, in skin, glass or porcelain).
// 1. plan(): the fingering of every note of each hand (fingering.js: a dynamic programme over fingers and hand places,
//    weighing how far the hand must move, how much it stretches, and awkward choices), then where each hand is.
// 2. pose(t): where every joint of both hands is at music time t (a pure function of t), with anticipation before a
//    note, the finger striking, holding the key down, and lifting.
// 3. The hands are drawn as one smooth surface each, ray-marched on the graphics card: a palm shaped as a rounded slab
//    with the thumb's and little finger's muscles, knuckles, tapered fingers with nails, the wrist and a sleeve.
import * as THREE from '../vendor/three.min.js?v=7';
import { isBlack } from './midi.js?v=13';
import { ANATOMY, PAD_TABLE, padLowest } from './handmesh.js?v=41';
import { planFingering, BANDS, COMFORTS, KEY_LAYOUTS, KEY_LAYOUT_DEFAULT, setKeyLayout as setFingeringLayout } from './fingering.js?v=7';

const A0 = 21, C8 = 108;
// The keyboard's layout (fingering.js KEY_LAYOUTS: 'piano', the default, or 'even'): the keys' places KX, the black keys'
// width, and the middle of each white key's narrow part between the black keys (SLOT: from the key's centre, by pitch
// class). Set by createHands (opts.keyLayout) for the hands it plans, and by keys.js for its keys.
export { KEY_LAYOUTS, KEY_LAYOUT_DEFAULT };
const KX = new Array(128).fill(0), SLOT = new Array(12).fill(0), SLOTW = new Array(12).fill(0), LAYOUT = { id: null, blackW: 0.56 };
export function setKeyLayout(id) {
  const L = setFingeringLayout(id), lid = KEY_LAYOUTS[id] ? id : KEY_LAYOUT_DEFAULT;
  for (let p = A0, n = 0; p <= C8; p++) { KX[p] = (isBlack(p) ? n - 0.5 + L.shift[p % 12] : n) - 25.5; if (!isBlack(p)) n++; }
  // (the white keys 0.94 wide (keys.js); a narrow part runs from the black key on its left, or its own left edge, to the
  // black key on its right, or its own right edge; by pitch class, from C4 to B4)
  for (let p = 60; p < 72; p++) {
    if (isBlack(p)) continue;
    const l = isBlack(p - 1) ? KX[p - 1] + L.blackW / 2 : KX[p] - 0.47, r = isBlack(p + 1) ? KX[p + 1] - L.blackW / 2 : KX[p] + 0.47;
    SLOT[p % 12] = Math.round(((l + r) / 2 - KX[p]) * 1e6) / 1e6; SLOTW[p % 12] = Math.round((r - l) * 1e6) / 1e6;
  }
  LAYOUT.id = lid; LAYOUT.blackW = L.blackW;
  return lid;
}
setKeyLayout(KEY_LAYOUT_DEFAULT);

// ---- the hand, in units of one white key (about 23.5 mm). Right hand; the left hand is its mirror image.
// The tunable numbers of the hand's posture and reach (tools/out/hands-design/FINAL-SPEC.md B3), measured on the rig with
// this file's own finger IK (final-scripts/posture-final.mjs; the S1 finish moved the hand back, see
// tools/out/hands-design/step-1.md).
// The fingers' last bone at a white key: its angle below horizontal depends almost only on how far in front of the knuckle
// the fingertip strikes (with this IK, the last joint bending half as much as the middle one): about 97 deg (on the nail) at
// 1.9 for the middle finger, 70 at 2.65, 60 at 3.0. Fingers 2-5 must strike white keys in front of the black keys (z >=
// slotZ), so the knuckles sit at Z0 7.1, 0.9 in front of the white keys' front edge, for curved fingers that play on the
// fleshy pad (last bone 65-75 deg). The thumb, whose base is 3 behind the knuckles, then plays at the keys' front edge with
// its first bone 8 % longer (S10(c)), the hand coming 0.4 forward while it holds a white key. (Pitched more than 15 deg,
// the thumb's base goes into the white keys' fronts when the hand is far forward for a thumb on a black key.)
const DEG = Math.PI / 180;
const CFG = {
  // (S2: the fingertip's pad now lies on the depressed key; in S1 the tip joint aimed 0.13 above the key's top and the pad
  // floated about 0.33 above the key. The hand comes down by the same 0.33, so the fingers keep S1's curve: Y0 2.0 -> 1.67.)
  Y0: 1.67, Z0: 7.1,                        // the middle knuckle: height above the white key tops, depth (white key fronts at z 6.2)
  PITCH0: 15 * DEG,                         // the hand pitched wrist-down: an arched hand, the wrist a little below the knuckles
  ROLL0: -6 * DEG,                          // rolled a little toward the little finger (which is short)
  yPerZ: 0.11,                              // the hand rises this much per unit it comes forward over the black keys (0.32 at the
                                            // most, back at S1's height: lower, the palm and wrist go into the keys' fronts)
  REST: [-2.35, -1.12, 0, 1.02, 2.0],       // fingertip x at rest, thumb to little finger, from the middle finger (five white keys)
  RHO: [0.94, 0.90, 0.87, 0.86, 0.92],      // natural knuckle-to-tip-joint distance at a strike, as a share of the finger's length
                                            // (last bone at a white key: median 68-73 deg below horizontal in Bach and Fur Elise)
  rhoRef: -0.2,                             // ... to a point this far above the key's top: about its depressed surface (spec S1.3)
  zWhite: [6.05, 5.1, 4.35, 4.7, 5.65],     // natural strike depth on a white key with the hand at Z0 (from RHO)
  ZNEED_BLACK: [2.95, 1.15, 0, 0.35, 1.7],  // how far forward the hand must come for each finger to play a black key (the spec's
                                            // values plus the 0.85 that Z0 moved back; the ring finger's measured, +0.1)
  ZNEED_WHITE: [0.4, 0, 0, 0, 0],           // ... and a white key (the thumb)
  zneedFingering: true,                     // the fingering's cost of the hand pumping in and out uses these (fingering.js)
  thumbBone: 1.08,                          // the thumb's first bone, lengthened (FINAL-SPEC S10(c); handmesh.js stretches its skin)
  slackWhite: 0.12, slackBlack: 0.06,       // how far from a key's centre a fingertip may strike (toward where the finger points;
                                            // the spec's 0.20 on a white key puts the pad's edge into the next black key)
  // (the measured corrections to the spec, each explained where it is used)
  slotZ: 4.35,                              // fingers 2-5 strike a white key in front of the black keys, the tip joint at z >= slotZ
  // (S4 fix) ... except while the hand comes forward for a thumb or little finger on a black key (the spec's posture
  // classes TB, LB and S on black keys; FINAL-SPEC B3's TB strike zone, B7 #13): then a finger 2-5 on C, E, F or B, whose
  // narrow part between the keys is 0.69 wide, follows the hand in there, its tip joint down to slotIn, slotX from the
  // key's centre toward its white neighbour (away from the black key: the white neighbour's top is level with the key's,
  // the black key stands 0.58 above it); and a finger on D, G or A (0.44 wide, narrower than a fingertip) stays in front
  // of the black keys and curls, its tip joint down to hDGA in front of its knuckle (hWhite otherwise).
  // (posture presets: a finger 2-5 goes into the narrow part only as deep as its skin, posed through its whole hold, lies
  // no more than slotSkin inside the black keys beside it, searched up to slotFront in front of slotZ: strikePoint)
  slotIn: 2.0, padSlot: 1.85, slotX: 0.25, slotReach: 1.2, slotSide: 40 * DEG, slotUp: [0.5, 0.72], slotPlay: 0.15, slotSkin: 0.012, slotFront: 0.6, hoverBlackQ: 0.15,
  strikeFwd: 0.05, strikeFront: 0.2,                          // (fingers round 1) a strike out of reach moves out along its key until this short at most
  leanRho: 0.97, leanMin: 0.04, leanMax: 1.5, leanMu: 0.02, leanOld: 0.2, leanChord: 0.03, leanSig: 0.05, leanLead: 0.1, leanHold: 0.1, leanApart: 2.0, leanCloseZ: 0.3, leanSlot: 4, leanGone: 0, leanRestrike: 0.03,
                                            // (fingers round 2) the hand leaning toward a key out of reach at the strike (below)
  freeFront: 5.9,                           // (fingers round 1) ... and its contact point no nearer the keys' front edge (6.2) than this
  freeFloor: 0.1,                           // (fingers round 1) a free fingertip's lowest skin, away from its keys, at least this high
  skinIn: 0.08, skinFree: 0.01, skinRamp: 0.06, skinClear: 0.04, skinSteep: 3.0, skinSteepMax: 0.5, foldAhead: 0.6, foldSlot: 0.5, foldMin: 0.1, foldSoft: 0.05, foldAfter: 0.02, foldScan: 0.5, foldStep: 0.02, skinLet: 0.03, skinMore: 0.01,   // (fingers round 1) posture presets: a free finger lifted out of the black keys (poseHand)
  slotHold: 0.9,                          // (fingers round 1) posture presets: ... and so does one leaving or striking a white key
                                            // up to this much in front of slotZ (a flat finger's last bone reaches back under the
                                            // black keys' fronts: Moonlight 3's right middle finger leaving C4 at 287.1 s, carried
                                            // on up the arpeggio, went 0.25 into C-sharp4)
  hDGA: [0, 1.75, 2.3, 1.85, 1.25],
  padZone: [4.2, 6.05], padBlack: 3.85,     // ... and where their pad may meet a white key, and a black key at most
  thumbZone: [4.1, 6.15],                   // the thumb's white-key zone (its front end: the thumb plays near the keys' front edge;
                                            // S3 fix: 6.05 -> 6.15, its pad 0.05 from the edge: 0.1 more reach for a thumb at its limit)
  thumbXs: -0.1,                            // (S3) the thumb strikes a white key this far from its centre toward the fingers (- away
                                            // from them): it lies on its side, and stretched to its key, its side facing the fingers
                                            // went into the next key (Fantaisie L: G2 into F2, C3 into B2; with the new fingering
                                            // the thumb plays a third of the left hand's notes there)
  thumbBlackLift: 0.2,                      // (S3) ... and comes down onto a black key from this much higher, eased in before the
                                            // strike and out by the contact (Fantaisie L: 20 frames of its side in the black key
                                            // before the contact)
  thumbContact: [0.24, 0.32, 0.33],         // its lowest skin from its tip joint: toward the fingers, below, back (measured)
  thumbFold: 0.80,                          // the thumb's knuckle-to-tip-joint distance at its tightest, as a share of its length
                                            // (0.76 at its full bend: strikePoint)
  zoneBlack: [[2.6, 3.85], [1.2, 3.7], [1.2, 3.7], [1.2, 3.7], [1.8, 3.7]],   // where each finger may strike a black key
  // While finger f (2-5) holds a key, its fingertip stays at least this far in front of its knuckle (horizontally), for the
  // whole hold: on a black key hHook (its middle bone then at most about 65 deg below horizontal; past 90 - PITCH0 it is
  // past the hand's vertical and the finger hooks back under the hand), on a white key hWhite (its last bone then at most
  // about 85 deg below horizontal, the middle finger's about 75: steeper, it plays on its nail). The strike depth is chosen
  // for the whole hold, and the hand's forward shift is held back while the finger holds its key (forwardSteps).
  // (S3: the middle finger's 2.25 -> 2.6. The new fingering uses the thumb more, and on a white key the thumb brings the
  // hand 0.4 forward (ZNEED_WHITE): with 2.25 the middle finger's last bone went from a median of 72 to 81 deg in Fur Elise.)
  hHook: [0, 1.3, 1.5, 1.35, 1.2],
  hWhite: [0, 1.9, 2.6, 2.05, 1.3],
  hookFwd: 0.5,                             // ... and at least this far in front of it along the hand (the hand's own frame)
  reachMax: 0.97,                           // ... and no further than this share of its length from where its knuckle is furthest back
  zPasses: 3, zPassesMax: 6,                // passes of strike points and forward-shift limits (each from the one before; S4 fix:
                                            // up to zPassesMax while a finger is newly refused the narrow part of its key: its limit
                                            // came from the pass before, which had it there; Op. 25's left index hooked on B3 at 75.70 s)
  sigZ: 0.085,                              // s: smoothing of the hand's forward shift and turn (a Gaussian, as in trackAt)
  gapZ: 0.30,                               // s: between two keys that need the hand forward less than this apart, it stays forward
  capTail: 0.15,                            // s: the shift stays held back until this long after a finger lets go (it lifts clear first)
  thumbTurn: [12 * DEG, 16 * DEG, 4 * DEG], // a thumb's key out of its reach turns the hand toward its little finger, 12 deg per
                                            // unit out, at most 16 deg, about the fingertips (turnPivot in front of the knuckle);
                                            // where the elbow turns the hand toward its thumb (frameAt's y0), at most 4 deg past
                                            // undoing that (S3 fix: Bach's left hand at C4, turned 16 deg toward its thumb by the
                                            // elbow, had its thumb 0.25 short of its E4 at 16 deg; at 20 deg it is on the key)
  turnPivot: 2.0,
  handOff: 0.15,                            // (S5) a key the other hand strikes next is let go this long before (planHands)
  thumbIn: 0.3,                             // (S5) with the other hand close, the right thumb strikes this much further in (strikePoint)
                                            // (0.9 kept the thumbs apart but cost the right thumb its reach: Bach's right hand, IK
                                            // miss at contact p95 0.40 -> 0.72; at 0.3, 0.29, and the hands' own pass keeps them apart)
  thumbTuck: 1.0,                           // (S5) a free thumb, with the other hand close (PATH.closeGap), rests this much in toward
                                            // its own fingers from its home REST[0] (under the index finger), out of the other hand's way
  spanFan: 0.6,                             // the spread posture S: the little finger fanned out this far (the ring finger 0.4 of it)
                                            // (fingers round 1: 0.35 -> 0.6; at 0.35 an octave's little finger was 0.5 short of
                                            // its key, stretched straight: Cornfield Chase's left hand on G1-G2 at 101.47 s.
                                            // Measured, auto: IK miss at contact p95 Op. 25 0.65 -> 0.49, Revolutionary 0.96 -> 0.85)
  spanYaw: 0,                               // ... and the hand turned toward its little finger (the spec's 10 deg: left to S6 with the
                                            // rest of the spread posture. Measured alone in S3: the thumbs reach (Revolutionary R1
                                            // IK miss median 0.46 -> 0.05) but the little fingers do not (R5 0.15 -> 0.54), with
                                            // hooked fingers in Op. 25 L (22 frames) and Moonlight L (30); 5 deg is half of each.
                                            // The spec's lower, flatter S posture (Y -0.45, pitch 7 deg) alone put the knuckles out of
                                            // their range in thousands of frames.)
  turnApart: [4.6, 4.6],                    // ... and no more than keeps its thumb's muscle clear of the other hand's: turned by a,
                                            // that side of the palm (about 1.9 out from the middle knuckle) swings toward the other
                                            // hand by about turnApart[1] sin a; the knuckles stay at least turnApart[0] + that apart
                                            // (S4 fix: the S3 rule, by the other thumb's rest place against this thumb's key, held
                                            // Op. 25's right hand to 40 % of its turn with the hands 7.5 apart, the thumb 1.5 short)
  thumbStraight: 0.12,                      // a free thumb is held up to this much higher when it is stretched nearly straight
  sideFree: [40 * DEG, 55 * DEG], sideFlip: 0.3,           // a free finger's sideways turn at the knuckle: eased in past the first, never the second
  airReach: [0.85, 1.05], airIn: 0.04,                   // ... and how far from its knuckle its last and next keys lie before it curls in on the way
  spreadFree: 0.25, spreadRest: 0.1, spreadIn: [0.06, 0.12],   // (fingers round 1) a free finger 2-5 reaches no more than this beyond its
                                            // natural spread (REST, fanned, plus spreadRest: where the rest pose puts it), softly
                                            // (round 2: 0.3 -> 0.25, so that its tip joint, a little further out than its contact
                                            // point, stays within 0.3: Gymnopedie's right little finger was 0.30-0.33 out)
  freeReach: [0.8, 0.9], freeIn: 0.02,      // (fingers round 1) ... and its tip joint stays within these shares of its length from its knuckle
                                            // (curl round: fingers 2-5 by curlFree[0] instead, below; the thumb and the touching scan keep it)
  // (curl round) The curl limit (tools/out/hands-design/curl/curl.md): how far a finger bends, as its middle joint's bend
  // in deg (PIP; the IK bends the last joint `dip` times as much, 0.3-0.5, so the DIP follows), for the lyrical and the
  // classical posture ([lyrical, classical], blended by the classical weight w; legacy as classical). A pianist's finger
  // is a gentle arch, never a hook: at rest PIP 30-45, DIP 10-20 (the hand's position of function); playing, PIP up to
  // about 70-80 with the DIP never folded sharply.
  // - curlFree: a free finger 2-5 bends no less than curlFree[0] (never straight; was freeReach's 0.8-0.9 of its length,
  //   which held every free finger at 42-60 deg, a claw: Gymnopedie 40 s, Cornfield Chase 101.4 s) and no more than
  //   curlFree[1], both soft over curlSoft deg. Too straight, its tip joint is drawn in toward its knuckle; too round, it is
  //   carried out along the hand at its height (the bend moves from the middle joint to the knuckle: the finger is lifted
  //   from the knuckle, not curled) and, carried out over the black keys, rises over them (curlLift: in full once carried
  //   that far; by how far it was carried out only, it rose and fell as the hand slid across the black keys, Gymnopedie's
  //   little fingers).
  // - (curl fix) Near its keys the band widens to take in the bend the finger has as it strikes its next key or let go of
  //   its last (so the limit is never switched off, in a fast passage too, and the finger never curls more than it plays):
  //   the roundest end eases from that bend to curlFree[1] over curlRelax[0] s plus curlRelax[1] s per finger length the
  //   two differ (a finger folded on a key under its knuckle unfolds slowly; in 0.1 s it jolted, Gymnopedie's right index
  //   finger at 17.3 s), and fully only where the finger is free for longer than curlSpan. Next to a folded key (the tip
  //   joint within curlSlack[1]-[2] of its length from the knuckle) that bend is taken curlSlack[0] of its length rounder:
  //   carried out along the hand from under its knuckle, the tip stepped up to 1.3 in 1/600 s (Revolutionary's right index
  //   finger at 6.007 s). The straightest end eases out
  //   over curlBack times freeOut / freeIn, as freeReach did. (fingers round 1 and 2's freeReach stays for the thumb and
  //   the two hands' touching scan.)
  // (The thumb is not limited here: its IK bends it at most 1.2 rad at its MCP, 69 deg, its IP half as much, and its
  // free bend was 39-42 deg at the median, 58-62 at p95. Carried out along the hand, a free thumb about to strike was left
  // 0.66 short of its key, Fur Elise 15.57 s.)
  // - curlStrike: a finger 2-5 strikes a key no nearer its knuckle than it reaches with this bend: the strike moves in along
  //   the key (createHands; a middle finger on a black key just in front of its knuckle, Revolutionary 5.58 s, lyrical: PIP 95).
  // - curlHeld: a finger 2-5 on its key lets go once the hand, moving on, would bend it more than this (the pedal holds the
  //   sound), from curlAfter s after its key reached the bottom.
  curlFree: [[22, 32], [34, 40]], curlSoft: 6, curlRelax: [0.08, 0.75], curlSpan: [0.15, 0.4], curlLift: 0.2, curlSlack: [0.15, 0.7, 0.85], curlBack: 0.6,
  curlStrike: [72, 78], curlHeld: [80, 86], curlAfter: 0.02, curlStep: 0.04,
  freeOut: 0.025,                           // (fingers round 2) ... eased in over this after it lets go (poseHand)
  heldReach: 0.985, heldSoft: 0.03,         // (fingers round 2) a finger 2-5 on its key: its tip joint within this share of its length (poseHand)
  thumbFree: 0.3, thumbFreeT: 0.25,         // a free thumb goes no more than this further out than its reach (eased in over 0.25 s)
  restQ: [0.2, 0.1],                        // (fingers round 1) posture presets, by the classical weight w: a free finger 2-5 rests
                                            // restQ[0] w further out along the hand than its strike depth, restQ[1] w lower over the
                                            // black keys (at its strike depth and hoverBlackQ higher, a Classical free finger was
                                            // clawed: Gymnopedie 40 s, knuckles bent back up to 6 deg, middle joints 51-65 deg; now 6-10 and 42-55)
  hoverY: 0.4,                              // a free fingertip's lowest skin at rest, this high above the white keys (S1: its tip
                                            // joint 0.6 above them, with the hand 0.33 higher)
  thumbRestY: 0.75,                         // ... the free thumb's tip joint
  hoverBlack: 0.25,                         // ... raised this much where it rests over the black keys (their tops are at 0.58)
  blackClear: 4.5,                          // ... from where its lowest skin is nearer the black keys than this (eased in over 0.3)
  liftUp: 0.3, liftUpBlack: 0.25,           // a finger travelling to or from a white (black) key does it this high above the key's top
  arcUp: 0.1,                               // ... and rises up to this much more between two keys 2 or more apart
                                            // (S1: 0.5 and 0.3 for the tip joint; with the hand 0.33 lower, those bent the free
                                            // fingers back at the knuckle, MCP past -20 deg, 2-7 times as often as in S1)
  sideClear: 0.05,                          // a fingertip carried sideways off its key keeps this far above the keys beside it
  liftDeep: 0.15,                           // a finger travelling to or from a white key near the black keys' fronts does it this
                                            // high above the black keys' tops (not into them)
  // The keys (FINAL-SPEC S2): a key reaches the bottom at its note's onset, so the fingertip meets it d s earlier
  // (contact, tc) and rides it down; d from how loud the note is (research section 1), within a share of the time since
  // this finger or this key was last let go. After the release the key rises over RET s, and the fingertip rides up with
  // it for `ride` s before it lifts away.
  dVel: [[0.25, 0.14], [0.5, 0.06], [0.75, 0.03], [1, 0.02]],   // (velocity, descent time in s), linear between
  dMin: 0.012, dShare: 0.45,
  RET: 0.08, rideMax: 0.04, rideShare: 0.4, rideMove: 0.15,
  rideThumb: 0,                             // (S3) the thumb does not ride up with its key: it lifts off as it lets go (riding up,
                                            // a thumb stretched out to its key had its side in the rising key: Moonlight's
                                            // repeated A-flat3 at 84-94 s, 30 frames)
  depthLead: 0.26,                          // s: ... and in time for the hand to come forward for a black key (createHands)
  dragSide: 45 * DEG, dragAfter: 0.01,      // ... and before a finger 2-5 holding it would turn more than dragSide sideways at its
                                            // knuckle as the hand moves on (from dragAfter s after the key reaches the bottom)
  squash: 0.01,                             // the pad presses this far into its key
  rideUp: 0.03,                             // ... and rides it up this far off its surface once it lets it go (below)
  betaNom: [30 * DEG, 70 * DEG, 70 * DEG, 70 * DEG, 70 * DEG],   // the last bone's usual angle at a strike (for the strike depth)
  beta0: [35 * DEG, 75 * DEG, 75 * DEG, 75 * DEG, 75 * DEG],     // ... and the first guess of the pad-aware IK (S2.4)
  ikPasses: 3,                              // IK passes per finger (the last through solveFinger): the thumb's first-pass pose, from
                                            // the table, is far from its final one, and a second pass from the posed pad lands it
  liftMax: 0.3,                             // a fingertip that cannot reach its contact aims higher by about how far it falls short,
                                            // at most this much (stretched straight at the key's height, it would lie across the next keys)
};
const REST = CFG.REST;
// The hand's own frame: origin at the middle finger's knuckle, x across toward the little finger, y up (the back of the
// hand), z back toward the wrist. A man's hand: palm about 9 cm wide and 11 cm long.
const MCP_L = [null, [-0.98, -0.06, 0.14], [0, 0, 0], [0.92, -0.08, 0.16], [1.7, -0.3, 0.5]];  // knuckles of fingers 2-5
const CMC_L = [-1.2, -0.62, 3.1];                                                              // the thumb's base joint
const WRIST_L = [0.2, -0.12, 4.45];
const SEG = [[1.9, 1.38, 1.12], [1.88, 1.12, 0.92], [2.08, 1.28, 0.96], [1.96, 1.2, 0.94], [1.55, 0.92, 0.84]];
const RAD = [[0.56, 0.48, 0.43, 0.36], [0.42, 0.39, 0.35, 0.3], [0.44, 0.41, 0.36, 0.31], [0.41, 0.38, 0.34, 0.29], [0.36, 0.33, 0.3, 0.26]];
// With the real hand model loaded, its own joints and bone lengths are used, so the mesh and the pose agree.
if (ANATOMY) {
  for (let f = 1; f < 5; f++) MCP_L[f] = ANATOMY.mcp[f];
  CMC_L.splice(0, 3, ...ANATOMY.cmc); WRIST_L.splice(0, 3, ...ANATOMY.wrist);
  for (let f = 0; f < 5; f++) SEG[f] = ANATOMY.seg[f];
}
// Longer fingers (handmesh.js PROPORTIONS: fingers 2-5 about FK times the length the numbers above were measured with)
// keep the same curve over the same keys. The knuckles stand FK times as far from where the fingers strike (a white
// key's depressed surface, rhoRef under its top, at the middle finger's natural depth zWhite[2]): the hand a little
// higher and further back, the wrist about where it was (the palm being shorter). The bones did not all grow alike (the
// proximal ones most), and a finger whose first bone is longer, reaching the same share of its length, ends its last
// bone steeper; so where a white key's strike is set by the finger's reach (RHO, its share of the length to the tip
// joint) or by its least reach in front of the knuckle (hWhite, and hDGA on D, G and A), that number is solved again so
// that the finger, bent in its own plane as the IK bends it (the last joint half as much as the middle one), meets the
// key with its last bone at the same angle below horizontal as the model's own bones did. On a black key the least
// reach (hHook, set by the middle bone's angle) grows with FK. Nothing else about the posture changes. (Measured on five
// pieces against the model's own bones: the same pad angles; fewer IK misses and keys down with no fingertip on them.
// With the knuckles kept at their height and moved back only, the longer free thumbs met in Fur Elise.)
const FK = ANATOMY && ANATOMY.fingerScale ? ANATOMY.fingerScale : 1;
if (FK !== 1 && ANATOMY.seg0) {
  const v0 = CFG.Y0 - CFG.rhoRef, v1 = v0 * FK, old = ANATOMY.seg0;
  CFG.Y0 = v1 + CFG.rhoRef;
  CFG.Z0 = CFG.zWhite[2] + (CFG.Z0 - CFG.zWhite[2]) * FK;
  CFG.hHook = CFG.hHook.map((h) => h * FK);
  // the planar chain: its reach (knuckle to tip joint) and the last bone's angle below that chord, for middle-joint bend th
  const reach = (L, th) => { const x = L[0] + L[1] * Math.cos(th) + L[2] * Math.cos(1.5 * th), y = L[1] * Math.sin(th) + L[2] * Math.sin(1.5 * th); return [Math.hypot(x, y), Math.atan2(y, x)]; };
  const betaAt = (L, h, v) => {   // the last bone's angle below horizontal, the tip joint h in front of the knuckle and v below it
    const D = Math.hypot(h, v); let lo = 0, hi = 1.9;
    for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (reach(L, m)[0] > D) lo = m; else hi = m; }
    const th = (lo + hi) / 2; return Math.asin(Math.min(1, v / D)) - reach(L, th)[1] + 1.5 * th;
  };
  for (let f = 1; f < 5; f++) {
    const L0 = old[f], L1 = SEG[f], S0 = L0[0] + L0[1] + L0[2], S1 = L1[0] + L1[1] + L1[2];
    // the reach at which the new finger's last bone is as steep as the old one's at h0 (it flattens as the reach grows)
    const same = (h0) => { const goal = betaAt(L0, h0, v0); let lo = 0, hi = Math.sqrt(S1 * S1 - v1 * v1); for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (betaAt(L1, m, v1) > goal) lo = m; else hi = m; } return (lo + hi) / 2; };
    CFG.RHO[f] = Math.hypot(same(Math.sqrt((CFG.RHO[f] * S0) ** 2 - v0 * v0)), v1) / S1;
    CFG.hWhite[f] = same(CFG.hWhite[f]); CFG.hDGA[f] = same(CFG.hDGA[f]);
  }
}
SEG[0] = [SEG[0][0] * CFG.thumbBone, SEG[0][1], SEG[0][2]];

// ---- the hand's posture (the studio's "Hand posture" setting; tools/out/hands-design/posture/posture.md, after
// posture-study.md section 5). Two presets, each with three columns (a white-key passage, a black-key group, a chord of
// 3 or more notes):
// - lyrical (flat): the knuckles at the white keys' front edge, low (1.35 above the key tops), the wrist only 0.57 below
//   them; long, flat fingers (last bone 35-45 deg below horizontal), playing deep on the keys, the long fingers in
//   the narrow white strips between the black keys;
// - classical (curved): the knuckles 0.45 in front of the keys, 1.65 high, the wrist 1.03 below them; moderately curved
//   fingers (last bone 52-65 deg), playing 0.3-0.7 deeper than before.
// Auto blends the two by each hand's local note rate (and loudness); every preset moves toward its black-key column where
// most notes are black and toward its chord column at chords, slowly (Gaussians of a few tenths of a second, led ahead
// of the music), so a posture change is a slow background drift, never a jolt.
// Numbers for this rig (handmesh.js PROPORTIONS: fingers 12 % longer than the posture study's): the study's knuckle
// depths and heights, wrist drops and target last-bone angles kept; the pitch solved for the wrist drop with the shorter
// palm (posture/scripts/derive.mjs), then each finger's RHO calibrated on this file's own pose (posture/scripts/calib.mjs:
// slow white, black and chord passages, the median last-bone angle at the key bottom), so the contacts lie 0.2-0.5
// deeper than the study's. With the last joint bending half as much as the middle one the lyrical fingers reached about
// 40 deg, not 35, before they were stretched straight, so in the lyrical columns it bends 0.3 as much (dip). A finger
// goes between the black keys only as deep as its skin fits there through its whole hold (strikePoint, skinInBlack), and
// where it does not fit the hand comes out a little (the front weight, createHands). Per column, right hand:
//   Y0, Z0, pitch (deg): the middle knuckle's height and depth, the hand's pitch;
//   RHO: each finger's natural reach at a strike (as CFG.RHO); zTip: the tip joint's natural depth on a white key (a free
//   finger's place in the hand); beta: the last bone's natural angle (deg; for the strike's height and the pad);
//   hWhite / hDGA / hHook: the tip joint's least reach ahead of its knuckle while it holds a white key, one of D, G, A, or
//   a black key (as CFG's: about 10-15 deg steeper than natural at most); reachMax (as CFG's);
//   cefb / dga: how deep (tip joint z) a finger 2-5 may strike C, E, F, B and D, G, A, in the narrow part between the
//   black keys (0.6-0.67 wide in the 'piano' key layout); lift: the finger's lift between notes, as a share of CFG's
//   (lyrical: legato, lower); dip: the last joint's bend as a share of the middle joint's (solveChain).
// 'legacy' (not in the menu; render-frames --set handPosture=legacy) is the posture before this setting: CFG's numbers
// and code paths; with the 'even' key layout (--set keyLayout=even) it is the hands of 20046b4 exactly (hand-metrics on
// 11 pieces).
export const HAND_POSTURES = [
  { id: 'auto', name: 'Auto' },
  { id: 'lyrical', name: 'Lyrical' },
  { id: 'classical', name: 'Classical' },
];
const DIP_LYR = 0.3;
const POSTURE = {
  lyrical: {
    white: { Y0: 1.35, Z0: 6.2, pitch: 6.5, RHO: [0.94, 1.0, 1.0, 1.0, 1.0], zTip: [6.05, 3.07, 2.22, 2.71, 4.21], beta: [30, 35, 35, 35, 33],
      hWhite: [0, 2.95, 3.6, 3.3, 2.2], hDGA: [0, 2.7, 3.35, 3.05, 1.95], hHook: [0, 2.6, 3.3, 2.95, 1.8], reachMax: 1.0, cefb: 2.0, dga: 2.0, lift: 0.8, dip: DIP_LYR },
    black: { Y0: 1.6, Z0: 5.6, pitch: 4.4, RHO: [0.94, 1.0, 1.0, 1.0, 0.963], zTip: [6.05, 2.3, 1.51, 1.88, 3.55], beta: [30, 30, 30, 30, 25],
      hWhite: [0, 2.95, 3.6, 3.3, 2.2], hDGA: [0, 2.7, 3.35, 3.05, 1.95], hHook: [0, 2.6, 3.3, 2.95, 1.8], reachMax: 1.0, cefb: 2.0, dga: 2.0, lift: 0.8, dip: DIP_LYR },
    chord: { Y0: 1.5, Z0: 6.4, pitch: 6.5, RHO: [0.94, 1.0, 0.969, 0.995, 1.0], zTip: [6.05, 3.37, 2.64, 3.07, 4.31], beta: [30, 45, 45, 45, 40],
      hWhite: [0, 2.85, 3.4, 3.2, 2.1], hDGA: [0, 2.6, 3.15, 2.95, 1.85], hHook: [0, 2.5, 3.1, 2.8, 1.7], reachMax: 1.0, cefb: 2.0, dga: 2.0, lift: 0.8, dip: DIP_LYR },
  },
  classical: {
    white: { Y0: 1.65, Z0: 6.65, pitch: 13, RHO: [0.94, 0.941, 0.875, 0.912, 1.0], zTip: [6.05, 3.93, 3.4, 3.69, 4.9], beta: [30, 58, 65, 60, 52],
      hWhite: [0, 2.55, 2.9, 2.8, 1.95], hDGA: [0, 2.3, 2.65, 2.55, 1.7], hHook: [0, 2.5, 2.9, 2.75, 1.8], reachMax: 0.97, cefb: 2.0, dga: 2.0, lift: 1, dip: 0.5 },
    black: { Y0: 1.8, Z0: 5.9, pitch: 8.7, RHO: [0.94, 0.99, 0.928, 0.962, 0.93], zTip: [6.05, 2.72, 2.2, 2.4, 3.7], beta: [30, 45, 50, 45, 32],
      hWhite: [0, 2.55, 2.9, 2.8, 1.95], hDGA: [0, 2.3, 2.65, 2.55, 1.7], hHook: [0, 2.5, 2.9, 2.75, 1.8], reachMax: 0.99, cefb: 2.0, dga: 2.0, lift: 1, dip: 0.5 },
    chord: { Y0: 1.85, Z0: 6.6, pitch: 3.4, RHO: [0.94, 0.943, 0.878, 0.904, 1.0], zTip: [6.05, 4.01, 3.5, 4.02, 5.2], beta: [30, 62, 68, 65, 55],
      hWhite: [0, 2.3, 2.8, 2.55, 1.65], hDGA: [0, 2.05, 2.55, 2.3, 1.45], hHook: [0, 2.4, 2.8, 2.6, 1.7], reachMax: 0.97, cefb: 2.0, dga: 2.0, lift: 1, dip: 0.5 },
  },
  // Auto (posture-study.md 5.3), per hand, at each of its events (notes within 35 ms): the classical weight
  // w = smoothstep(rate[0], rate[1], r) + loud[2] smoothstep(loud[0], loud[1], v), r its note rate (events per second, from
  // the median time between events within 4 either side), v the mean loudness of its notes within near s; the black
  // weight smoothstep(black[0], black[1], b), b the share of black keys within near s; the chord weight 1 at an event
  // of 3 or more notes. Each held from its event to the next, then smoothed by a Gaussian of sig s, and taken lead s ahead.
  rate: [4, 8], loud: [0.7, 0.9, 0.25], black: [0.35, 0.65], near: 0.5,
  sigW: 0.35, leadW: 0.3, sigK: 0.2, leadK: 0.15, sigC: 0.2, leadC: 0.1,
  // The front weight (createHands): at an event where a finger 2-5 plays a white key it does not fit into between the
  // black keys, the hand comes front[0] further out (lyrical; front[1] classical), smoothed by sigF s and led leadF s, so
  // the finger plays in front of the black keys with its natural curve instead of hooking down under its knuckle there;
  // slant: how far across from that key's narrow part a knuckle may be for its finger to lie along it.
  front: [0.6, 0], sigF: 0.15, leadF: 0.1, slant: 0.35,
};
const PKEYS = ['RHO', 'zTip', 'beta', 'hWhite', 'hDGA', 'hHook'];
// The knuckle depth at which each finger reaches a black key (the thumb: also a white key) with the hand not moved
// forward: CFG.ZNEED as depths (the hand comes forward by Z0 - these, at least 0)
const ZABS_BLACK = CFG.ZNEED_BLACK.map((z) => CFG.Z0 - z), ZABS_WHITE = CFG.ZNEED_WHITE.map((z) => CFG.Z0 - z);
// one column: arrays as they are (beta in radians)
const colOf = (c) => ({ ...c, pitch: c.pitch * DEG, beta: c.beta.map((b) => b * DEG) });
const PCOL = { lyrical: {}, classical: {} };
const buildPosture = () => {
  for (const s of ['lyrical', 'classical']) for (const k of ['white', 'black', 'chord']) PCOL[s][k] = colOf(POSTURE[s][k]);
  PFLAT = ['lyrical', 'classical'].flatMap((s) => ['white', 'black', 'chord'].map((k) => flatOf(PCOL[s][k])));
};
// the posture with the classical weight w, the black weight k and the chord weight c: (1 - k) white + k black, then
// toward the chord column by c, for each preset; then lyrical to classical by w (each number linear)
// (each column flattened in the order of FLAT, five numbers for each key of PKEYS)
const FLAT = ['Y0', 'Z0', 'pitch', 'reachMax', 'cefb', 'dga', 'lift', 'dip'];
const flatOf = (C) => Float64Array.from([...FLAT.map((k) => C[k]), ...PKEYS.flatMap((k) => C[k])]);
let PFLAT = null;
// (u: the front weight: the hand dz further out, its fingers' natural depths with it: POSTURE.front, by w)
function blendPosture(w, k, c, lean = false, u = 0) {
  k *= 1 - u;   // (held out in front, the hand does not also come in over the black keys)
  const n = lean ? 3 : PFLAT[0].length, [LW, LB, LC, KW, KB, KC] = PFLAT, v = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = (1 - c) * (LW[i] + k * (LB[i] - LW[i])) + c * LC[i], b = (1 - c) * (KW[i] + k * (KB[i] - KW[i])) + c * KC[i];
    v[i] = a + w * (b - a);
  }
  const dz = u * (POSTURE.front[0] + w * (POSTURE.front[1] - POSTURE.front[0]));
  const q = { Y0: v[0], Z0: v[1] + dz, pitch: v[2], w, k, c, u };
  if (lean) return q;
  for (let j = 3; j < FLAT.length; j++) q[FLAT[j]] = v[j];
  PKEYS.forEach((key, j) => { const o = FLAT.length + 5 * j; q[key] = [v[o], v[o + 1], v[o + 2], v[o + 3], v[o + 4]]; });
  for (let f = 1; f < 5; f++) q.zTip[f] += dz;
  return q;
}
buildPosture();
// (for the measuring tools: the tables, and rebuilding the columns after changing them)
export const POSTURE_TABLES = { POSTURE, rebuild: buildPosture, skinInBlack: (...a) => skinInBlack(...a) };   // (skinInBlack: for the measuring scripts)
// the posture before this setting (CFG), in the same form
const LEGACY_Q = { Y0: CFG.Y0, Z0: CFG.Z0, pitch: CFG.PITCH0, w: 1, k: 0, c: 0, RHO: CFG.RHO, zTip: CFG.zWhite, beta: CFG.betaNom, hWhite: CFG.hWhite, hDGA: CFG.hDGA, hHook: CFG.hHook,
  reachMax: CFG.reachMax, cefb: CFG.slotIn, dga: CFG.slotZ, lift: 1, dip: 0.5, legacy: true };
const WHITE_TOP = 0, BLACK_TOP = 0.58;
const keyTop = (p) => (isBlack(p) ? BLACK_TOP : WHITE_TOP);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

// ---- the keys (FINAL-SPEC S2.2). A key turns about its back end (z = 0), KEY_TILT radians at full depth (keys.js draws it
// so). keySurfaceY: the height of key `pitch`'s top at depth z when it is pressed `depth` (0 up .. 1 at the bottom).
export const KEY_TILT = { white: 0.042, black: 0.055 };
export const keySurfaceY = (pitch, z, depth) => keyTop(pitch) - z * Math.sin(depth * (isBlack(pitch) ? KEY_TILT.black : KEY_TILT.white));
// One press's key depth at t: from the contact tc the key goes down, starting as fast as the fingertip lands (exponent
// pl.p) and reaching the bottom at onKey (the onset: the sound); it stays down until the release off, then rises over RET.
export function pressDepth(pl, t) {
  if (t < pl.tc) return 0;
  if (t < pl.onKey) { const s = (t - pl.tc) / pl.d; return 1 - (1 - s) ** pl.p; }
  if (t < pl.off) return 1;
  const u = (t - pl.off) / CFG.RET; return u >= 1 ? 0 : 1 - u * u * (3 - 2 * u);
}

// ---- contact (FINAL-SPEC S2.3, S2.4): the finger code places each fingertip's lowest skin (its contact point c); the
// tip joint's target is worked out from it with the pad table (handmesh.js), by the last bone's angle below horizontal.
const PAD = PAD_TABLE || [0.15, 0.08, 0.05, 0.05, 0.05].map((b) => ({ betas: [0, 110], below: [b, b], ahead: [0, 0] }));
function padLookup(f, beta) {
  const T = PAD[f], B = T.betas, n = B.length, deg = clamp(beta / DEG, B[0], B[n - 1]);
  const i = Math.min(n - 2, Math.floor((deg - B[0]) / (B[1] - B[0]))), u = (deg - B[i]) / (B[i + 1] - B[i]);
  return { below: T.below[i] + u * (T.below[i + 1] - T.below[i]), ahead: T.ahead[i] + u * (T.ahead[i + 1] - T.ahead[i]) };
}
// the tip joint's target for contact point c, the last bone pointing beta below horizontal along fwd (horizontal, from
// the knuckle toward c): above c by the pad's depth under the joint (less the squash), in front of it by `ahead`
function tipTarget(f, c, fwd, beta) {
  const b = padLookup(f, beta);
  return c.clone().addScaledVector(fwd, b.ahead).setY(c.y + b.below - CFG.squash);
}
// The tip joint's target for contact point c from the pad's lowest skin exactly as the mesh is posed with joints J (hand
// frame F): c less that skin's offset from the tip joint (handmesh.js padLowest; it matters for the thumb, which plays on
// its side), pressed squash into the key; null without the model. "Lowest" is along n: the key's own normal (a pressed
// key is tilted up to 0.055 rad: the pad touches its surface, not a level plane through c), or the world's up.
function tipTargetExact(f, c, J, F, n = null) {
  const nx = n ? n.x : 0, ny = n ? n.y : 1, nz = n ? n.z : 0;
  const o = padLowest(f, J.map((p) => F.local(p)), F.local(V(F.O.x + nx, F.O.y + ny, F.O.z + nz)));
  if (!o) return null;
  const w = F.rot(o);
  return V(c.x - w.x - CFG.squash * nx, c.y - w.y - CFG.squash * ny, c.z - w.z - CFG.squash * nz);
}
// the upward normal of key `pitch`'s top when it is pressed `depth` (it turns about its back end, its front going down)
function keyNormal(pitch, depth) {
  const a = depth * (isBlack(pitch) ? KEY_TILT.black : KEY_TILT.white);
  return V(0, Math.cos(a), Math.sin(a));
}
// how far the last bone of joints J points below horizontal (radians, 0 when it points up)
function distalBeta(J) {
  const dx = J[3].x - J[2].x, dy = J[3].y - J[2].y, dz = J[3].z - J[2].z;
  return Math.max(0, Math.asin(clamp(-dy / (Math.hypot(dx, dy, dz) || 1), -1, 1)));
}
// the tip joint's height when finger f holds key p at the bottom at depth z, the last bone at its usual angle (for the
// strike depth: strikePoint)
const tipY = (f, p, z, Q = LEGACY_Q) => keySurfaceY(p, z, 1) + padLookup(f, Q.beta[f]).below - CFG.squash;
// behind z 3.95 a white key is only its narrow part between the black keys: its centre's offset there, by pitch class,
// SLOT (setKeyLayout, above: C and F lie left of their black key, E and B right of theirs; D, G and A sit between two)
// (S4 fix) C, E, F and B: a finger 2-5 may strike them in their narrow part (CFG.slotIn); D, G and A, in the posture
// before the posture setting, it may not (they were 0.44 wide, narrower than a fingertip)
const WIDE = (p) => [0, 4, 5, 11].includes(p % 12);
const slotMin = (p, Q = LEGACY_Q) => (WIDE(p) ? Q.cefb : Q.dga);   // (the posture's: legacy CFG.slotIn and slotZ)
// the least reach ahead of the knuckle while finger f holds key p: on a black key, a white key, or D, G, A
const hOfQ = (f, p, Q) => (isBlack(p) ? Q.hHook : WIDE(p) ? Q.hWhite : Q.hDGA)[f];

// ---------------------------------------------------------------- fingering
// The fingering is fingering.js's (FINAL-SPEC S3: FM2 with this rig's reach bands and posture classes). Each event gets
// its fingers fs, its hand anchor (the middle finger's rest place), its practical window lo..hi and comfortable window
// clo..chi of anchors (every key within its finger's practical / comfortable reach), its posture class post (N, F
// forward, S spread, TB thumb on a black key, LB little finger on one), zneed and the thumb crossings.
// How far from a key's centre finger f may strike it (toward where the finger points). The thumb strikes a white key at
// its centre (less thumbXs): it is wide, and lies on its side, so further off the centre its skin is in the next key.
const slackOf = (f, p) => (isBlack(p) ? CFG.slackBlack : f === 0 ? 0 : CFG.slackWhite);

// How far forward the hand is (toward the black keys) over time, as steps [t0, t1, level] that stepsAt smooths (FINAL-SPEC
// S1.3's e.z rule, made exact at each key): needOf(press, finger) gives what each press needs, ZNEED_BLACK for a finger on
// a black key (and ZNEED_WHITE for a white one), from a moment before the fingertip meets the key (tc: so that the
// smoothed hand is there when it does) until it lifts from the key (off + ride). The steps are the highest need at each moment, and a gap shorter than gapZ
// between two needs is bridged (the hand does not pump back and forth between keys that need it forward). capOf(press,
// finger) then limits the level while a finger holds its key (createHands: p.cap), from the same moment before the contact
// until capTail after the release: with the hand further forward, a finger 2-5 already on its key would come too near its
// knuckle (on a white key it plays on its nail, on a black key it hooks back under the hand). The same function, with no
// caps, gives the steps of the hand's turn for the thumb.
function forwardSteps(presses, needOf, capOf = null, more = null) {
  const lead = 2.2 * CFG.sigZ, layers = [[needOf, capOf], ...(more ? [more] : [])].map(([nd, cp]) => {
    const iv = [];
    for (let f = 0; f < 5; f++) for (const p of presses[f]) {
      const need = nd(p, f);
      if (need > 0) iv.push([p.tc - lead, Math.max(p.off + p.ride, p.tc + lead), need]);
    }
    return { iv, cp };
  });
  const ivAll = layers.flatMap((L) => L.iv);
  if (!ivAll.length) return [];
  const DT = 0.005, t0 = ivAll.reduce((m, v) => Math.min(m, v[0]), Infinity) - CFG.gapZ - 1;
  const n = Math.ceil((ivAll.reduce((m, v) => Math.max(m, v[1]), -Infinity) + CFG.gapZ + 1 - t0) / DT) + 1;
  const at = (t) => Math.round((t - t0) / DT);
  // (each layer: its needs, closed, then held back by its own caps; the level is the higher of the layers)
  const g = new Float32Array(n);
  for (const { iv, cp } of layers) {
    const gl = new Float32Array(n);
    for (const [a, b, lev] of iv) for (let i = Math.max(0, at(a)), e = Math.min(n - 1, at(b)); i <= e; i++) if (gl[i] < lev) gl[i] = lev;
    // closing (a gap shorter than gapZ between two levels is raised to the lower of them): the largest level within gapZ
    // before and after, then the smaller of the two
    const w = Math.round(CFG.gapZ / DT), back = new Float32Array(n), fwd = new Float32Array(n);
    const runMax = (src, dst, dir) => { const q = []; for (let k = 0; k < n; k++) { const i = dir > 0 ? k : n - 1 - k; while (q.length && src[q[q.length - 1]] <= src[i]) q.pop(); q.push(i); while (Math.abs(q[0] - i) > w) q.shift(); dst[i] = src[q[0]]; } };
    runMax(gl, back, 1); runMax(gl, fwd, -1);
    for (let i = 0; i < n; i++) gl[i] = Math.max(gl[i], Math.min(back[i], fwd[i]));
    if (cp) for (let f = 0; f < 5; f++) for (const p of presses[f]) {
      const cap = cp(p, f); if (cap == null) continue;
      for (let i = Math.max(0, at(p.tc - lead)), e = Math.min(n - 1, at(p.off + (p.capTail ?? CFG.capTail))); i <= e; i++) if (gl[i] > cap) gl[i] = cap;
    }
    for (let i = 0; i < n; i++) if (gl[i] > g[i]) g[i] = gl[i];
  }
  const steps = [];
  for (let i = 0; i < n;) { let j = i; while (j + 1 < n && g[j + 1] === g[i]) j++; if (g[i] > 0) steps.push([t0 + (i - 0.5) * DT, t0 + (j + 0.5) * DT, g[i]]); i = j + 1; }
  return steps;
}
// steps [t0, t1, level] (in time order, not overlapping) smoothed by a Gaussian of sig s, at time t (a pure function of t)
function stepsAt(steps, t, sig) {
  let lo = 0, hi = steps.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (steps[m][1] < t - 5 * sig) lo = m + 1; else hi = m; }
  let v = 0;
  for (let i = lo; i < steps.length && steps[i][0] < t + 5 * sig; i++) v += steps[i][2] * (Phi((steps[i][1] - t) / sig) - Phi((steps[i][0] - t) / sig));
  return v;
}

// What the fingering needs to know of this rig (tools/fingering-tests.mjs uses it too): the keys' descent time, and how
// far forward the hand comes for each finger on a black key (on this rig the index and little finger need 1.15 and 1.7,
// not the spec's 0.3 and 0.85: Z0 moved 0.85 back in S1). Not ZNEED_WHITE: the thumb's 0.4 on a white key is a stopgap
// that S6's depth channel replaces, and counted, it turned the fingering away from the thumb (Fur Elise's A4: 2 for 1).
export function fingeringOptions() { return { dOf: dOfVel, zneed: CFG.zneedFingering ? { black: CFG.ZNEED_BLACK, white: [0, 0, 0, 0, 0] } : null }; }
// The plan of both hands (FINAL-SPEC S3.1): the fingering (fingering.js: the rescue may give the other hand a note its own
// hand cannot play), then each finger's presses { on, off, pitch, note, f, hand, post, cross, ev, cutEv, floor, dups }. A
// press lets go of its key here at the note's end, but in time for this finger's next key (min(0.04, 0.45 of the time
// between the two onsets) before it), when the fingering's next hand place cannot reach it (cutEv: by that event's onset
// here; createHands makes it exact, from that event's contact), and 0.03 s before this key is struck again by any finger;
// and never sooner than 0.05 s after its onset (floor: less only when this finger plays again sooner). These are the
// releases the key timing is worked out from; createHands then takes the releases from the hand's path (FINAL-SPEC S4.4),
// which only ever makes them earlier, and adds three more (the hand moving on forward, or dragging the finger sideways).
export function planHands(notes, handOf) {
  const F = planFingering(notes, handOf, fingeringOptions());
  const hands = F.hands.map(({ side, events, stats }) => ({ side, events, presses: [[], [], [], [], []], fingering: stats }));
  hands.forEach((H, h) => {
    const ev = H.events;
    const cutAt = new Map(); ev.forEach((e, i) => { for (const n of e.cuts) cutAt.set(n, i); });
    ev.forEach((e, i) => e.notes.forEach((n, k) => {
      const f = e.fs[k], c = cutAt.get(n), cutEv = c != null ? ev[c] : null;
      const off = Math.min(n.onset + n.dur, cutEv ? cutEv.t : Infinity);
      const dups = e.dups ? e.dups.filter(([, m]) => m === n).map(([d]) => d) : null;
      H.presses[f].push({ on: n.onset, off, pitch: n.pitch, note: n, f, hand: h, post: e.post, cross: e.cross[k], ev: i, cutEv, dups: dups && dups.length ? dups : null });
    }));
    for (const pr of H.presses) {
      pr.sort((a, b) => a.on - b.on);
      for (let i = 0; i + 1 < pr.length; i++) { const g = pr[i + 1].on - pr[i].on; pr[i].offNext = pr[i + 1].on - Math.min(0.04, 0.45 * g); pr[i].floor = pr[i].on + Math.min(0.05, 0.6 * g); }
    }
  });
  // a key struck again (by any finger of either hand) is let go 0.03 s before; struck next by the other hand, handOff s
  // before, so that the finger is off it as the other hand's comes down onto it (S5: Moonlight 153.0 s, the left thumb
  // on A flat 2 until 0.06 s before the right hand's middle finger struck it, and the two went into each other)
  const byPitch = new Map();
  for (const H of hands) for (const pr of H.presses) for (const p of pr) { if (!byPitch.has(p.pitch)) byPitch.set(p.pitch, []); byPitch.get(p.pitch).push(p); }
  for (const L of byPitch.values()) {
    L.sort((a, b) => a.on - b.on || a.hand - b.hand || a.f - b.f);
    for (let i = 0; i + 1 < L.length; i++) { const q = L.slice(i + 1).find((x) => x.on > L[i].on + 1e-9); if (q) L[i].offKey = q.on - (q.hand === L[i].hand ? 0.03 : CFG.handOff); }
  }
  for (const H of hands) for (const pr of H.presses) for (const p of pr) {
    p.floor = p.floor ?? p.on + 0.05;
    p.off = Math.max(p.floor, Math.min(p.off, p.offNext ?? Infinity, p.offKey ?? Infinity));
    delete p.offNext;
  }
  hands.rescued = F.rescued; hands.stats = F.stats;
  return hands;
}

// ---------------------------------------------------------------- the hand's path across the keys (FINAL-SPEC S4)
const ease = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
const ease5 = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * k * (10 + k * (6 * k - 15)));   // (curl round: smooth to the second derivative)
const erf = (x) => { const s = x < 0 ? -1 : 1; x = Math.abs(x); const k = 1 / (1 + 0.3275911 * x); return s * (1 - k * (0.254829592 + k * (-0.284496736 + k * (1.421413741 + k * (-1.453152027 + k * 1.061405429)))) * Math.exp(-x * x)); };
const Phi = (x) => 0.5 * (1 + erf(x / Math.SQRT2));
// The hand's anchor across the keys, x(t) (the middle finger's knuckle), is a uniform cubic B-spline with control points c
// every dt s from T0 (FINAL-SPEC Appendix 1): C2, and a pure function of t (clamped to its first and last spans outside
// them, where the hand rests). PATH: the path's parameters (FINAL-SPEC B3; T section 5).
const PATH = {
  dt: 0.01, tau: 0.15,                      // knot spacing; laziness: the speed term's time constant
  wm: 2e4, wc: 1e6, wh: 1e8, wHold: 1e5,    // weights (per second; the jerk term weighs 1): lazy target, comfort, hard, hold
  whLeap: 3,                                // ... the hard windows of a leap's arrival and of a tight leap's last strike before it,
                                            // this much stiffer (the jerk term otherwise drew the hand off early: the Revolutionary's
                                            // right thumb 1.0 short of G4 at 5.89 s, before the leap to F5-F6; R presses outside
                                            // their window by > 0.3: 1.9 % -> 0.9 %)
  // Two hands (FINAL-SPEC S5): each hand's path is solved alone, then again with the other hand's path as a one-sided
  // window this stiff (wSep: w_h / 10), the right hand's knuckle at least G right of the left hand's: gThumbs while both
  // thumbs are on their keys or within thumbNear s of a press, else gPalm (eased between the two over thumbNear); rounds.
  wSep: 1e7, wSepYield: 0.01, gPalm: 4.4, gThumbs: 5.5, thumbNear: 0.15, sepRounds: 2,
  // ... except in a crossing: where both hands' strike windows leave the knuckles less than crossGap apart. It runs while
  // the hands, each on its own path, are closer than that, padded by crossPad s; the crossing hand plays from above and
  // further in (crossLift, crossIn), eased in and out (a Gaussian of crossSig s about the padded ends).
  crossGap: 2.0, crossNear: 0.15, crossTie: 1.25, susMin: 0.6, crossPad: 0.12, crossLift: 1.3, crossIn: -0.9, crossSig: 0.07,
  crossArc: [1.2, 5.5, 0.06], crossFree: 0.12, crossStay: 1.5, crossPassW: 0.15,
                                            // ... and passing over the other hand, crossArc[0] higher still while the knuckles are
                                            // less than crossArc[1] apart across the keys in a free stretch (shorter than crossFree
                                            // s, only where the hand also moves crossStay or more across the keys), from crossArc[2]
                                            // s before to after: an arc over it (eased like the rest), its free fingers drawn in
  crossElbow: 4.0, crossPitch: -20 * DEG,  // ... its wrist raised (pitched this much toward wrist-up) and its elbow raised this much, so
                                            // its wrist and forearm pass over the back of the other hand (lifted only with the hand,
                                            // they went through it: Interstellar 158-182 s, the right hand's metacarpals in the left
                                            // wrist and forearm by up to 0.96)
  // ... and close hands (knuckles less than closeGap apart) play one in front of the other: the right hand closeIn further
  // in, the left closeOut nearer the pianist, eased over closeSig s (FINAL-SPEC S5.4)
  closeGap: 5.8, closeIn: -0.5, closeOut: 0.3, closeSig: 0.085, closeThumbL: 0.5, closeThumbR: 3.5,
                                            // (S5 fix) ... the right hand only while the left thumb is in use (thumbNear, at least
                                            // closeThumbL), or while its own thumb is on a key (or within thumbNear s of one) with
                                            // a key of the left hand down within closeThumbR of it: in front of the left hand. (Always, it
                                            // cost Moonlight 3's right hand its reach, IK miss at contact p95 1.72 -> 1.89.)
  // ... and where, with all that, the two hands would still touch (their bones' capsules, the mesh's own girths: tested at
  // apartDt s steps while the knuckles are less than apartNear apart or in a crossing), one hand is lifted or the two are
  // moved apart in depth (the right hand apartZ[0] of it further in, the left apartZ[1] nearer, or the other way round),
  // whichever parts them most, by apartGain times the overlap plus apartMargin, held apartHold s each side and eased (a
  // Gaussian of apartSig s), at most apartMax, in apartRounds rounds (apartOff below; apartTry: the trial's size)
  apartDt: 0.025, apartNear: 8.5, apartGain: 1.2, apartMargin: 0.12, apartHold: 0.12, apartSig: 0.08, apartMax: 2.2, apartRounds: 10, apartTry: 1.0, apartScan: 0.1, apartTuck: 0.5,
  apartLast: [4, 3.2],                      // ... and where the hands still touch after those rounds, apartLast[0] more, up to apartLast[1]
  apartZ: [0.6, 0.4], apartPlay: [0.1, 0.6], // (a hand with a key down or struck within apartPlay[0] s: lifting it counts apartPlay[1] worse)
  // (S5 fix) the free fingers are drawn in (above) only from a finger's release and until its next strike, eased in and
  // out over tuckIn s (at most half the time in the air): drawn in at once, a finger leaving its key with the hand lifted
  // or crossing snapped 1-1.8 to its place in the hand in one frame (Fur Elise's right thumb at 63.89 s, Interstellar's
  // left thumb at 159.56 s)
  tuckIn: 0.06,
  holdTau: 0.5,                             // the hold window's weight falls off as exp(-(t - on) / holdTau)
  strikePre: 0.02, strikePost: 0.02,        // the hard window: from tc - strikePre to onKey + strikePost
  comfortPre: 0.04, comfortCut: 0.05,       // the comfort window: from tc - comfortPre to the note's end, or the next contact - comfortCut
  lazyLead: 0.05,                           // the lazy target moves on to the next event's anchor this long before its contact
  idle: 1.0, idleRamp: 0.8,                 // ... in a gap of more than idle s, it ramps there over the last idleRamp s
  holdCut: 0.12,                            // a held key the next hand place cannot reach is held (softly) until this long before
                                            // that place's contact (the shortest leap: the hand then sets off)
  leapGap: 1.0, vCap: 140, lunge: 1.0, lateMax: 0.04,   // leaps (S4.2): window gap that makes one; speed cap; lunge; latest strike
  hurryHold: 0.01,                          // ... a key a tight leap leaves from is held this long at the bottom at least (below)
  lateFirst: true,                          // ... a late strike before a lunge (below)
  hurryLate: 0.02,                          // ... and a late strike after a hurried departure at least this late (below)
  iters: 30,
  sReal: true, wcThumbS: 10, sRealNear: 0.1,   // the spread posture's thumb held to the reach it has as posed, by a comfort window
                                            // this much stiffer, where the events within sRealNear s allow it (below)
  rollMin: 0.3, rollFit: 0.15, rollEarly: 0.04, rollLate: 0.04, rollMove: 0.05,   // (fingers round 1) a chord this much wider than the hand
                                            // reaches is rolled: its lower keys (rollFit short at most) early, the rest late (below)
  leaveFar: 0.2,                            // (fingers round 1) ... and once it is this far beyond its finger's length, early (below)
  leave: 0.1,                               // a press lets go once x(t) carries its key this much further out of its window (S4.4)
  moveV: 2, moveMerge: 0.03, moveEnd: 0.05, moveMin: 1.5,   // moves (S4.5)
};
function bspline(c, T0, dt, t) {
  const N = c.length; if (N < 4) return N ? c[0] : 0;
  let u = (t - T0) / dt; if (u < 1) u = 1; else if (u > N - 2) u = N - 2;
  let k = Math.floor(u); if (k > N - 3) k = N - 3;
  const f = u - k, g = 1 - f, f2 = f * f, f3 = f2 * f;
  return (g * g * g * c[k - 1] + (3 * f3 - 6 * f2 + 4) * c[k] + (-3 * f3 + 3 * f2 + 3 * f + 1) * c[k + 1] + f3 * c[k + 2]) / 6;
}
// A symmetric positive definite banded system (half-bandwidth 3; D[d][k] = A[k][k + d]) by LDL^T (proto.mjs solveBanded).
function bandedLDLT(D, b, n, L, dg) {
  for (let k = 0; k < n; k++) {
    let s = D[0][k];
    for (let m = 1; m <= 3 && k - m >= 0; m++) s -= L[m][k - m] * L[m][k - m] * dg[k - m];
    dg[k] = s;
    for (let r = 1; r <= 3 && k + r < n; r++) {
      let v = D[r][k];
      for (let m = 1; m + r <= 3 && k - m >= 0; m++) v -= L[m][k - m] * L[m + r][k - m] * dg[k - m];
      L[r][k] = v / s;
    }
  }
  const y = Float64Array.from(b);
  for (let k = 0; k < n; k++) for (let m = 1; m <= 3 && k - m >= 0; m++) y[k] -= L[m][k - m] * y[k - m];
  for (let k = 0; k < n; k++) y[k] /= dg[k];
  for (let k = n - 1; k >= 0; k--) for (let m = 1; m <= 3 && k + m < n; m++) y[k] -= L[m][k] * y[k + m];
  return y;
}
// FINAL-SPEC S4.3 (T section 5.3): the control points c that minimise
//   J = int x'''^2 + tau^-4 int x'^2 + int wm(t) (x - m)^2 + sum over the windows of int w(t) dist^2(x, [lo(t), hi(t)])
// (the window terms sampled at the knots, x_k = (c[k-1] + 4 c[k] + c[k+1]) / 6. The windows: hard, comfort, hold and the
// other hand's room (S5's bound, one-sided), each with its own weight per knot, 0 where it does not apply; an unbounded
// side is +-Infinity.) By a penalty active set: solve with the windows that x breaks penalised, update which those are,
// until none changes (at most PATH.iters); banded LDL^T, half-bandwidth 3, with a 1e-9 ridge.
function solvePath({ N, dt, tau, m, wm, windows, init = null }) {
  const base = [0, 1, 2, 3].map(() => new Float64Array(N)), lj = 1 / dt ** 5, lv = tau ** -4 / (4 * dt);
  for (let k = 0; k + 3 < N; k++) {          // jerk on span k: (c[k+3] - 3 c[k+2] + 3 c[k+1] - c[k]) / dt^3
    const co = [-1, 3, -3, 1];
    for (let a = 0; a < 4; a++) for (let q = a; q < 4; q++) base[q - a][k + a] += lj * co[a] * co[q];
  }
  for (let k = 1; k + 1 < N; k++) { base[0][k - 1] += lv; base[0][k + 1] += lv; base[2][k - 1] -= lv; }   // speed (c[k+1] - c[k-1]) / 2dt
  for (let k = 0; k < N; k++) base[0][k] += 1e-9;
  const D = [0, 1, 2, 3].map(() => new Float64Array(N)), b = new Float64Array(N);
  const L = [null, new Float64Array(N), new Float64Array(N), new Float64Array(N)], dg = new Float64Array(N);
  const act = windows.map(() => new Int8Array(N));
  const flip = (a, k, v, lo, hi) => { const o = a[k], n = v < lo - 1e-4 ? -1 : v > hi + 1e-4 ? 1 : o < 0 && v <= lo ? -1 : o > 0 && v >= hi ? 1 : 0; a[k] = n; return n !== o ? 1 : 0; };
  // (warm start, S5: the windows that a previous solution init breaks start active)
  if (init) for (let k = 1; k + 1 < N; k++) {
    const v = (init[k - 1] + 4 * init[k] + init[k + 1]) / 6;
    for (let q = 0; q < windows.length; q++) { const W = windows[q]; if (W.w[k] > 0) flip(act[q], k, v, W.lo[k], W.hi[k]); }
  }
  let c = null, it = 0, changed = 0;
  for (; it < PATH.iters; it++) {
    for (let d = 0; d < 4; d++) D[d].set(base[d]);
    b.fill(0);
    for (let k = 1; k + 1 < N; k++) {
      let w = wm[k] * dt, r = w * m[k];
      for (let q = 0; q < windows.length; q++) {
        const a = act[q][k]; if (!a) continue;
        const W = windows[q], v = a < 0 ? W.lo[k] : W.hi[k], s = W.w[k] * dt; w += s; r += s * v;
      }
      const w36 = w / 36;
      D[0][k - 1] += w36; D[0][k] += 16 * w36; D[0][k + 1] += w36; D[1][k - 1] += 4 * w36; D[1][k] += 4 * w36; D[2][k - 1] += w36;
      b[k - 1] += r / 6; b[k] += (4 * r) / 6; b[k + 1] += r / 6;
    }
    c = bandedLDLT(D, b, N, L, dg);
    changed = 0;
    for (let k = 1; k + 1 < N; k++) {
      const v = (c[k - 1] + 4 * c[k] + c[k + 1]) / 6;
      for (let q = 0; q < windows.length; q++) { const W = windows[q]; if (W.w[k] > 0) changed += flip(act[q], k, v, W.lo[k], W.hi[k]); }
    }
    if (!changed) break;
  }
  return { c, iters: Math.min(it + 1, PATH.iters), unsettled: changed };
}
// One hand's path (FINAL-SPEC S4.1-S4.3, S4.5), worked out in the hand's own lateral coordinate u (the right hand's is x,
// the left hand's MIR - x, the mirror image about D4, as in fingering.js), so that a left hand playing the mirror image of
// the right hand gets exactly the mirror image of its path (the mirror test). live: the hand's events that are struck (with
// the fingering's windows and their presses' timing; the leap policy has run: e.wlo/e.whi, e.dwell, e.leap, e.hurry).
// winU(p): press p's own practical window of anchors in u (its finger's band in its event's posture class, with the key's
// slack). Returns the problem { side, live, T0, dt, N, m, wm, windows, hard } that solveProblem solves (S5: with the
// other hand's room added).
const MIR = 2 * KX[62];
// the reach bands of the spread posture S as the hand is posed until S6 (BANDS.S with the thumb's normal reach)
const SREAL = BANDS.S.map((b, f) => (f === 0 ? BANDS.N[0] : b));
function pathProblem(side, live, winU, fallback, range = null) {
  const dt = PATH.dt, U = (v) => (side > 0 ? v : MIR - v), UI = (lo, hi) => (side > 0 ? [lo, hi] : [MIR - hi, MIR - lo]);
  if (!live.length) return { side, live, empty: true, T0: 0, dt, N: 4, u0: U(fallback) };
  let tA = Infinity, tB = -Infinity;
  for (const e of live) { tA = Math.min(tA, e.tc); for (const p of e.pr) tB = Math.max(tB, p.on + p.note.dur, p.off); }
  // (S5: over both hands' time, range, so that the separation can move a hand that has stopped or not yet begun out of the
  // other's way; on its own time only, its path was held where its last note left it: Liszt's Consolation 3 from 236 s,
  // the left hand silent, the right hand thrown back 4.4 keys after each of its chords)
  if (range) { tA = Math.min(tA, range[0]); tB = Math.max(tB, range[1]); }
  const T0 = tA - 1, N = Math.ceil((tB + 1 - T0) / dt) + 3;
  const kOf = (t) => Math.max(1, Math.min(N - 2, Math.round((t - T0) / dt)));
  const hLo = new Float64Array(N).fill(-Infinity), hHi = new Float64Array(N).fill(Infinity), hOn = new Float64Array(N).fill(-Infinity), hW = new Float64Array(N);
  const cLo = new Float64Array(N).fill(-Infinity), cHi = new Float64Array(N).fill(Infinity), cW = new Float64Array(N).fill(PATH.wc);
  const dLo = new Float64Array(N).fill(-Infinity), dHi = new Float64Array(N).fill(Infinity), wd = new Float64Array(N), dOn = new Float64Array(N).fill(-Infinity);
  const m = new Float64Array(N);
  const sLo = new Float64Array(N).fill(-Infinity), sHi = new Float64Array(N).fill(Infinity), sW = new Float64Array(N);
  // (windows meeting at a knot intersect; where they do not overlap, the newer one wins there)
  const put = (Lo, Hi, On, k, lo, hi, on) => {
    const a = Math.max(Lo[k], lo), b = Math.min(Hi[k], hi);
    if (a <= b) { Lo[k] = a; Hi[k] = b; } else if (on >= On[k]) { Lo[k] = lo; Hi[k] = hi; }
    if (on > On[k]) On[k] = on;
  };
  const cOn = new Float64Array(N).fill(-Infinity);
  live.forEach((e, i) => {
    const next = live[i + 1];
    // hard: the event's practical window (lunging: widened toward the hand's last place), while its keys are struck (and
    // from tc - dwell before a leap the hand has time for: it arrives, then strikes)
    const w = PATH.wh * (e.leap || e.hurry ? PATH.whLeap : 1);
    const [wlo, whi] = UI(e.wlo, e.whi), [clo, chi] = UI(e.pclo ?? e.clo, e.pchi ?? e.chi), a0 = U(e.anchor);
    if (e.roll) {
      // (fingers round 1: a rolled chord, its lower part until its keys reach the bottom, then its upper part)
      const R = e.roll, [alo, ahi] = UI(...R.A), [blo, bhi] = UI(...R.B);
      for (let k = kOf(R.tcA - Math.max(PATH.strikePre, e.dwell)), k1 = kOf(R.onA); k <= k1; k++) { put(hLo, hHi, hOn, k, alo, ahi, e.t); hW[k] = Math.max(hW[k], w); }
      for (let k = Math.max(kOf(R.onA) + 1, kOf(R.tcB - PATH.strikePre)), k1 = kOf(R.onB + (e.hurry ? 0 : PATH.strikePost)); k <= k1; k++) { put(hLo, hHi, hOn, k, blo, bhi, e.t + 1e-6); hW[k] = Math.max(hW[k], w); }
    } else for (let k = kOf(e.tc - Math.max(PATH.strikePre, e.dwell)), k1 = kOf(e.onKey + (e.hurry ? 0 : PATH.strikePost)); k <= k1; k++) { put(hLo, hHi, hOn, k, wlo, whi, e.t); hW[k] = Math.max(hW[k], w); }
    // comfort: its comfortable window, from just before the contact until its notes end or the next contact comes near
    const end = Math.max(e.onKey + PATH.strikePost, Math.min(e.t + e.dur, next ? next.tc - PATH.comfortCut : Infinity));
    const [rlo, rhi] = e.roll ? UI(...e.roll.B) : [clo, chi];
    for (let k = kOf(e.tc - PATH.comfortPre), k1 = kOf(end); k <= k1; k++) { put(cLo, cHi, cOn, k, rlo, rhi, e.t); if (e.pclo != null) cW[k] = Math.max(cW[k], PATH.wc * PATH.wcThumbS); }
    // hold (soft, fading): each held key's own window, after its strike until its note ends, or until its finger must let
    // go of it anyway (its next key, the key struck again) or the next hand place, which cannot reach it, comes near
    for (const p of e.pr) {
      const [lo, hi] = winU(p), t1 = Math.min(p.on + p.note.dur, p.offKey ?? Infinity, p.offNextTc ?? Infinity, p.cutEv && p.cutEv.tc != null ? p.cutEv.tc - PATH.holdCut : Infinity);
      // (S5: a key held on under a later strike of this hand, as a chord sustained under a melody, or a long note (susMin s
      // or more) also goes in `sus`, which the crossing test reads: the hand does not let go of it to make room)
      let sus = p.note.dur >= PATH.susMin;
      for (let j = i + 1; j < live.length && live[j].tc < t1; j++) if (live[j].tc > p.onKey + PATH.strikePost) { sus = true; break; }
      for (let k = kOf(p.onKey + PATH.strikePost), k1 = kOf(t1); k <= k1; k++) {
        const w = PATH.wHold * Math.exp(-(T0 + k * dt - p.on) / PATH.holdTau);
        const a = Math.max(dLo[k], lo), bb = Math.min(dHi[k], hi);
        if (a <= bb) { dLo[k] = a; dHi[k] = bb; wd[k] = Math.max(wd[k], w); } else if (p.on >= dOn[k]) { dLo[k] = lo; dHi[k] = hi; wd[k] = w; }
        if (p.on > dOn[k]) dOn[k] = p.on;
        if (sus) { sLo[k] = Math.max(sLo[k], lo); sHi[k] = Math.min(sHi[k], hi); sW[k] = 1; }
      }
    }
    // the lazy target: the event's anchor from just before its contact until just before the next's (a long gap: it ramps
    // to the next anchor, minimum-jerk, over the last idleRamp s)
    const k0 = i ? kOf(e.tc - PATH.lazyLead) : 0, k1 = next ? kOf(next.tc - PATH.lazyLead) : N;
    for (let k = k0; k < k1; k++) m[k] = a0;
    if (next && next.tc - e.tc > PATH.idle) {
      const r0 = next.tc - PATH.lazyLead - PATH.idleRamp, a1 = U(next.anchor);
      for (let k = Math.max(k0, kOf(r0)); k < k1; k++) { const u = clamp((T0 + k * dt - r0) / PATH.idleRamp, 0, 1); m[k] = a0 + (a1 - a0) * u * u * u * (10 - 15 * u + 6 * u * u); }
    }
  });
  const wm = new Float64Array(N).fill(PATH.wm);
  const windows = [{ lo: hLo, hi: hHi, w: hW }, { lo: cLo, hi: cHi, w: cW }, { lo: dLo, hi: dHi, w: wd }];
  return { side, live, T0, dt, N, m, wm, windows, hard: windows[0], sus: { lo: sLo, hi: sHi, w: sW } };
}
// Solve a hand's path problem, with extra windows (S5: the other hand's room), from a previous solution's active sets
// (warm start). (Control points kept in double precision: in single precision, at |x| ~ 20 they are 2e-6 apart, and the
// mirror test asks for 1e-6; FINAL-SPEC S4.3 asked for a Float32Array.)
function solveProblem(P, extra = [], init = null) {
  if (P.empty) return { u: Float64Array.of(P.u0, P.u0, P.u0, P.u0), iters: 0, unsettled: 0 };
  const S = solvePath({ N: P.N, dt: P.dt, tau: PATH.tau, m: P.m, wm: P.wm, windows: P.windows.concat(extra), init });
  return { u: S.c, iters: S.iters, unsettled: S.unsettled };
}
// The hand's moves (FINAL-SPEC S4.5), from the solved x at 100 Hz: runs where |x'| > moveV in one direction, merged across
// gaps shorter than moveMerge s, each extended to where its speed falls to moveEnd of its peak; kept with |D| >= moveMin.
// vel: the loudest note of the first event struck as it ends (for S6's arcs).
function movesOf(c, T0, dt, live, side) {
  const h = 0.01, t0 = T0 + dt, n = Math.floor((T0 + (c.length - 2) * dt - t0) / h);
  if (n < 2) return [];
  const X = new Float64Array(n + 1); for (let i = 0; i <= n; i++) X[i] = bspline(c, T0, dt, t0 + i * h);
  const v = new Float64Array(n); for (let i = 0; i < n; i++) v[i] = (X[i + 1] - X[i]) / h;
  const runs = [];
  for (let i = 0; i < n;) {
    if (Math.abs(v[i]) <= PATH.moveV) { i++; continue; }
    const s = Math.sign(v[i]); let j = i; while (j + 1 < n && Math.sign(v[j + 1]) === s && Math.abs(v[j + 1]) > PATH.moveV) j++;
    const l = runs[runs.length - 1];
    if (l && l.s === s && (i - l.b) * h < PATH.moveMerge) l.b = j; else runs.push({ a: i, b: j, s });
    i = j + 1;
  }
  const out = [];
  for (const r of runs) {
    let pk = 0; for (let i = r.a; i <= r.b; i++) pk = Math.max(pk, Math.abs(v[i]));
    let a = r.a, b = r.b;
    while (a > 0 && Math.sign(v[a - 1]) === r.s && Math.abs(v[a - 1]) > PATH.moveEnd * pk) a--;
    while (b + 1 < n && Math.sign(v[b + 1]) === r.s && Math.abs(v[b + 1]) > PATH.moveEnd * pk) b++;
    const D = side * (X[b + 1] - X[a]);   // (in world x)
    if (Math.abs(D) < PATH.moveMin) continue;
    const ta = t0 + a * h, tb = t0 + (b + 1) * h;
    const e = live.find((q) => q.tc >= tb - 0.05);
    out.push({ t0: ta, t1: tb, D, vel: e ? Math.max(...e.pr.map((p) => p.vel)) : 0.7 });
  }
  return out;
}

// ---------------------------------------------------------------- pose

const V = (x, y, z) => new THREE.Vector3(x, y, z);
// The hand's frame (FINAL-SPEC B1): toWorld = T(O) · Ry(yaw) · diag(side, 1, 1) · Rx(pitch) · Rz(roll).
// roll > 0 lowers the thumb side; pitch > 0 lowers the wrist; yaw > 0 turns a forward-pointing finger toward world -x.
// Returns W (hand point -> world), rot (hand vector -> world), ax (the hand's axes in the world), toWorld and toHand.
function handFrame(O, yaw, pitch, roll, side, light = false) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  // diag(side, 1, 1) · Rx(pitch) · Rz(roll), row by row
  const a00 = side * cr, a01 = -side * sr, a02 = 0;
  const a10 = cp * sr, a11 = cp * cr, a12 = -sp;
  const a20 = sp * sr, a21 = sp * cr, a22 = cp;
  // Ry(yaw) in front
  const r00 = cy * a00 + sy * a20, r01 = cy * a01 + sy * a21, r02 = cy * a02 + sy * a22;
  const r10 = a10, r11 = a11, r12 = a12;
  const r20 = -sy * a00 + cy * a20, r21 = -sy * a01 + cy * a21, r22 = -sy * a02 + cy * a22;
  const W = (l) => V(O.x + r00 * l[0] + r01 * l[1] + r02 * l[2], O.y + r10 * l[0] + r11 * l[1] + r12 * l[2], O.z + r20 * l[0] + r21 * l[1] + r22 * l[2]);
  const rot = (l) => V(r00 * l[0] + r01 * l[1] + r02 * l[2], r10 * l[0] + r11 * l[1] + r12 * l[2], r20 * l[0] + r21 * l[1] + r22 * l[2]);
  const ax = { x: V(r00, r10, r20), y: V(r01, r11, r21), z: V(r02, r12, r22) };
  // (world point -> hand point: the rotation is orthogonal, so its inverse is its transpose)
  const local = (p) => { const dx = p.x - O.x, dy = p.y - O.y, dz = p.z - O.z; return [r00 * dx + r10 * dy + r20 * dz, r01 * dx + r11 * dy + r21 * dz, r02 * dx + r12 * dy + r22 * dz]; };
  if (light) return { O, side, yaw, pitch, roll, W, rot, ax, local };
  const toWorld = new THREE.Matrix4().makeBasis(ax.x, ax.y, ax.z).setPosition(O);
  return { O, side, yaw, pitch, roll, W, rot, ax, local, toWorld, toHand: toWorld.clone().invert() };
}

// a 3-segment finger from knuckle m toward tip target p; the middle joint bends by th, the last by 1.5 th. The finger
// lies in the plane of the knuckle-to-target line and `up`, and bends toward -up.
const WORLD_UP = V(0, 1, 0);
// (dip: the last joint's bend as a share of the middle joint's, 0.5 as a rule; the lyrical posture's flat fingers less:
// POSTURE dip)
function solveChain(m, p, L, maxBend = 1.9, up = WORLD_UP, dip = 0.5) {
  const d = p.clone().sub(m), D = d.length(), k1 = 1 + dip;
  const reach = (th) => { const a1 = -th, a2 = -k1 * th; const x = L[0] + L[1] * Math.cos(a1) + L[2] * Math.cos(a2), y = L[1] * Math.sin(a1) + L[2] * Math.sin(a2); return [Math.hypot(x, y), Math.atan2(y, x)]; };
  let lo = 0, hi = maxBend;
  if (D >= reach(0)[0]) hi = lo = 0;
  else if (D <= reach(maxBend)[0]) lo = hi = maxBend;
  else for (let i = 0; i < 22; i++) { const mid = (lo + hi) / 2; if (reach(mid)[0] > D) lo = mid; else hi = mid; }
  const th = (lo + hi) / 2, [, phi] = reach(th);
  const hor = d.clone().addScaledVector(up, -d.dot(up)), hl = hor.length() || 1, u = hor.multiplyScalar(1 / hl);
  const a0 = Math.atan2(d.dot(up), hl) - phi;
  const dir = (ang) => u.clone().multiplyScalar(Math.cos(ang)).addScaledVector(up, Math.sin(ang));
  const j1 = m.clone().addScaledVector(dir(a0), L[0]);
  const j2 = j1.clone().addScaledVector(dir(a0 - th), L[1]);
  const tip = j2.clone().addScaledVector(dir(a0 - k1 * th), L[2]);
  return [m.clone(), j1, j2, tip];
}
// (curl round) the chain's knuckle-to-tip distance with its middle joint bent by th (radians), the last by dip th: as
// solveChain bends it (a curl limit works on how far its target lies from its knuckle)
function chainReach(L, th, dip = 0.5) {
  const k1 = 1 + dip, x = L[0] + L[1] * Math.cos(th) + L[2] * Math.cos(k1 * th), y = L[1] * Math.sin(th) + L[2] * Math.sin(k1 * th);
  return Math.hypot(x, y);
}
// (the only IK call the measuring tool sees: tools/hand-metrics.mjs wraps it to learn each finger's target)
function solveFinger(m, p, L, maxBend, up, dip) { return solveChain(m, p, L, maxBend, up, dip); }

// A finger's base joint in the world for hand frame F: the knuckle (the thumb's: its base joint). The knuckle gives a
// little sideways toward the fingertip, a stand-in for the finger turning at the knuckle (FINAL-SPEC S1.2: in the hand's
// own frame, by 0.22 of the tip's offset across the hand from its rest place, at most 0.35).
// a finger's base joint in the hand's own frame: the thumb's base, or the knuckle, the ring and little fingers' moved out
// by the hand's fan (F.fan: the spread posture's little finger fanned out, the ring finger 0.4 of it; FINAL-SPEC B1)
const baseL = (F, f) => (f === 0 ? CMC_L : f < 3 || !F.fan ? MCP_L[f] : [MCP_L[f][0] + (f === 4 ? F.fan : 0.4 * F.fan), MCP_L[f][1], MCP_L[f][2]]);
function knuckle(F, f, tip) {
  const m = F.W(baseL(F, f));
  if (f > 0) m.add(F.rot([clamp(0.22 * (F.ax.x.dot(tip.clone().sub(F.O)) - REST[f]), -0.35, 0.35), 0, 0]));
  return m;
}

// Where finger f strikes a key (FINAL-SPEC S1.3), worked out once per press from the hand's frame F when the key is
// struck and then fixed, so a fingertip never slides on its key. (xs, zs) is where the pad's lowest skin meets the key
// (S2: before, it was the tip joint's place); zt is where the tip joint then is, along the key. Across the key: toward
// where the finger naturally points, within the key's slack (the thumb on a white key: its centre). Along the key: where
// the finger reaches it at its natural share of its length (RHO), kept to the part of the key that finger can play.
// Measured corrections to the spec:
// - for fingers 2-5 the depth is worked out for the tip joint, as in S1 (RHO, zones, hook and reach limits, all measured
//   for the tip joint), and the pad meets the key where its lowest skin lies when the finger is posed with its tip joint
//   there (handmesh.js padLowest; the pad table without the model): up to 0.1 further from the knuckle when it strikes
//   steeply (its fleshy pad lies under and just in front of the joint), nearer when it is flatter. Its own zones: padZone
//   on a white key (not into the black keys' fronts at 3.95, nor past the front edge at 6.2), padBlack on a black key (its
//   front end at 3.95).
// - fingers 2-5 always strike a white key in front of the black keys, the tip joint at z >= slotZ = 4.35 (spec 4.25: the
//   fingertip's skin reaches 0.3 beyond the tip joint, so at 4.25 it touches the black keys' fronts), never in its narrow
//   part between them (the spec's TB zone): there this rig's fingertip, 0.64-0.72 wide, is in the black keys on both sides
//   (A3, B7 #13). With the hand forward they curl instead; the hand's forward shift is held back while they hold their
//   keys (p.cap).
// - RHO is the share of the finger's length to the tip joint's own target, measured to a point rhoRef = 0.2 below the
//   key's top, about its depressed surface (the spec's own height; the S1 finish measured it 0.13 above the top, with the
//   hand 0.33 higher: the same shape of finger). The reach and hook limits use the tip joint's true height (tipY).
// - fingers 2-5 strike at least hNeed in front of their knuckle (hHook on a black key, hWhite on a white one), and a key
//   out to the side brings the strike nearer the knuckle only that far: nearer, the finger hooks back under the hand or
//   lies sideways on the key (more than 90 deg at the knuckle). With `hold`, that holds for the whole hold.
// - the thumb (S2): it plays on the side of its last bone, its lowest skin lying thumbContact from its tip joint (toward
//   the fingers, below, and back toward the pianist). It strikes as near the key's front end as it reaches, so that it
//   leaves its key over the front edge, not across the next key; but no nearer its base than it can fold (thumbFold of its
//   length; folded tighter it overshoots down into the keys), for the whole hold (`hold`: where its base is through it);
//   within thumbZone on a white key.
// (Q: the hand's posture at the strike: its natural reach RHO, hold limits, reachMax and how deep a finger may strike a
// white key between the black keys; LEGACY_Q, the CFG numbers, by default)
function strikePoint(f, pitch, F, hold = null, pad = true, noSlot = false, Q = LEGACY_Q) {
  const m = F.W(baseL(F, f)), L = SEG[f][0] + SEG[f][1] + SEG[f][2], blk = isBlack(pitch);
  const nat = F.O.x + F.side * (REST[f] + (f ? 0 : CFG.thumbContact[0]));   // where the finger's contact naturally lies
  const sl = slackOf(f, pitch);
  let xs = KX[pitch] + clamp(nat - KX[pitch], -sl, sl) + (!f && !blk ? F.side * CFG.thumbXs : 0);
  const hNeed = f ? (blk ? Q.hHook : Q.hWhite)[f] : 0;
  const ty = tipY(f, pitch, blk ? 2.6 : f === 0 ? 5.6 : Q.legacy ? 4.8 : Q.zTip[f], Q);   // (the key's surface at a usual depth: it varies by 0.04)
  const dx = xs - m.x, dy = ty - m.y, dyR = keyTop(pitch) + CFG.rhoRef - m.y, r2 = (Q.RHO[f] * L) ** 2 - dx * dx - dyR * dyR;
  let zs = f ? m.z - Math.sqrt(Math.max(hNeed * hNeed, r2)) : r2 > 0 ? m.z - Math.sqrt(r2) : m.z - 0.3;
  const zone = (blk ? CFG.zoneBlack[f] : f === 0 ? CFG.thumbZone : [slotMin(pitch, Q), 5.95]).slice();
  // (S5: with the other hand close, the right thumb strikes thumbIn further in along its key than the left thumb, so the
  // two thumbs, playing the same or neighbouring keys, pass one behind the other)
  if (f === 0 && F.side > 0 && F.close) zone[1] = Math.max(zone[0], zone[1] - CFG.thumbIn * F.close);
  // (fingers 2-5: in front of the black keys where they reach so; only the hand's forward shift during the hold, below,
  // takes one into the narrow part of its key)
  // (posture presets: as deep as the posture lets a finger strike that key, between the black keys)
  zs = clamp(zs, blk || !f || !Q.legacy ? zone[0] : CFG.slotZ, zone[1]);
  if (f === 0) {
    // (the tip joint's depth: within reach of the thumb's base where it is furthest back, and no nearer than it can fold
    // where it is furthest forward, over the whole hold; when both cannot be, not nearer than it can fold)
    const o = CFG.thumbContact, tyT = keySurfaceY(pitch, zone[1], 1) + o[1] - CFG.squash, txT = xs - F.side * o[0];
    let zReach = -Infinity, zFold = Infinity;
    for (const { k } of hold || [{ k: m }]) {
      const tx = txT - k.x, ty = tyT - k.y, rr = (Q.RHO[0] * L) ** 2 - tx * tx - ty * ty, rf = (CFG.thumbFold * L) ** 2 - tx * tx - ty * ty;
      zReach = Math.max(zReach, rr > 0 ? k.z - Math.sqrt(rr) : k.z - 0.3); zFold = Math.min(zFold, rf > 0 ? k.z - Math.sqrt(rf) : k.z);
    }
    zs = clamp(Math.min(Math.max(zone[1] - o[2], zReach), zFold) + o[2], zone[0], zone[1]);
  }
  // (in the narrow part: at its middle; before the posture setting (legacy), fingers 2-5 slotX from the key's centre toward
  // its white neighbour. Posture presets: a finger 2-5 reaching in at a slant from its knuckle, its contact shifted across
  // so that the finger's part between the black keys, from just beyond its pad to their front ends, is centred in the
  // narrow part; at most slotPlay off its middle)
  const G0 = f && hold ? hold[Math.round(0.5 * (hold.length - 1))].G : F;
  const slotX = (z) => {
    const c = KX[pitch] + SLOT[pitch % 12];
    if (!f) return c;
    if (Q.legacy) return KX[pitch] + Math.sign(SLOT[pitch % 12]) * CFG.slotX;   // (before the posture setting: slotX toward its white neighbour)
    // (the knuckle half-way through the hold, as it gives sideways toward the fingertip: knuckle())
    const mid = (Math.max(0, z - 0.2) + BLACK_FRONT) / 2;
    let x = c;
    for (let it = 0; it < 3; it++) {
      const mk = knuckle(G0, f, V(x, ty, z)), a = clamp((mid - z) / Math.max(0.5, mk.z - z), 0, 0.5);
      x = clamp((c - a * mk.x) / (1 - a), c - CFG.slotPlay, c + CFG.slotPlay);
    }
    return x;
  };
  if (f > 0 && hold) {
    // for the whole hold (hold: the knuckle and the hand's z axis at moments through it): at least hNeed in front of the
    // knuckle, and hookFwd in front of it along the hand (when the hand turns or moves on across the keys, a finger left
    // out to the side would point back past the hand's vertical); and within reach from where the knuckle is furthest
    // back. If it cannot be both: within reach (the hand's forward shift is then held back while the finger holds the key:
    // createHands); but if the key is out of reach anyway, or the hand turns or moves away from it, not hooked under.
    let k0 = Infinity, k1 = -Infinity, hiHand = Infinity;
    for (const { k, az } of hold) {
      if (k.z < k0) k0 = k.z; if (k.z > k1) k1 = k.z;
      hiHand = Math.min(hiHand, k.z - (CFG.hookFwd + az.x * (xs - k.x) + az.y * (ty - k.y)) / az.z);
    }
    const r = (Q.reachMax * L) ** 2 - dx * dx - dy * dy, hMax = Math.sqrt(Math.max(0, r)), hiDepth = k0 - hNeed;
    const depth = (z0) => { const lo = clamp(k1 - hMax, z0, zone[1]), hi = clamp(Math.min(hiDepth, hiHand), z0, zone[1]); return lo <= hi ? clamp(zs, lo, hi) : hMax < hNeed || hiHand < hiDepth ? hi : lo; };
    zs = depth(noSlot ? CFG.slotZ : zone[0]);
    // (S4 fix) in the narrow part only a finger that stays curled and points along it, through the whole hold: no further
    // than slotReach of its length from its knuckle, nor turned more than slotSide sideways (a finger stretched to its key,
    // or reaching across, lies diagonally over the black key beside it). Refused once, it stays refused in the later
    // passes (slotRefused), so that the last pass's forward-shift limits come from a strike in front of the black keys.
    if (!blk && zs < CFG.slotZ && Q.legacy) {
      const xS = KX[pitch] + Math.sign(SLOT[pitch % 12]) * CFG.slotX;
      if (!hold.every(({ k }) => Math.abs(xS - k.x) <= Math.tan(CFG.slotSide) * (k.z - zs) && Math.hypot(xS - k.x, ty - k.y, k.z - zs) <= CFG.slotReach * L)) { zs = depth(CFG.slotZ); noSlot = 'refused'; }
    }
    // (posture presets) only as deep between the black keys as the finger fits there, through the whole hold: its skin, as
    // this file's IK poses it from its knuckle at moments through the hold, no more than slotSkin inside the black keys
    // beside its key (a finger turned across its key, or a wide one, plays nearer the black keys' fronts, or in front of
    // them); the deepest such strike, by halving between the planned one and slotZ
    if (!blk && !Q.legacy && zs < CFG.slotZ + CFG.slotFront) {
      // (every other moment of the hold (they are 0.03 s apart: the hand may move across while the finger holds its key),
      // the middle first)
      const n = hold.length, idx = [...new Set([Math.round(0.5 * (n - 1)), 0, n - 1, ...[...hold.keys()].filter((i) => i % 2 === 0)])];
      const pen = (z) => {
        const x = z < CFG.slotZ ? slotX(z) : xs, tip = V(x, ty, z);
        let w = 0;
        for (const i of idx) { const G = hold[i].G; w = Math.max(w, skinInBlack(f, pitch, solveChain(knuckle(G, f, tip), tip, SEG[f], 1.9, G.ax.y, Q.dip))); if (w > CFG.slotSkin) break; }
        return w;
      };
      if (pen(zs) > CFG.slotSkin) {
        let lo = zs, hi = CFG.slotZ + CFG.slotFront;
        for (let it = 0; it < 7; it++) { const mz = (lo + hi) / 2; if (pen(mz) > CFG.slotSkin) lo = mz; else hi = mz; }
        // (fingers round 2: not where the hand is so far forward that in front of the black keys the finger would fold under
        // it, its tip joint less than foldSlot in front of its knuckle: it stays between the black keys, only as deep as that needs.
        // Refused, Moonlight 3's right middle finger on G4 at 85.82 s, the hand forward over the black keys for the thumb's
        // C-sharp4 and the little finger's D-sharp5, folded under the hand into G-sharp4, 0.4 deep)
        if (hi >= CFG.slotZ - 0.02) {
          const zf = depth(Math.max(hi, CFG.slotZ));
          const kz = Math.min(...hold.map(({ k }) => k.z));
          if (kz - zf < CFG.foldSlot) zs = depth(Math.max(zs, Math.min(zf, kz - CFG.foldSlot)));
          else { zs = zf; noSlot = 'refused'; }
        } else zs = depth(hi);
      }
    }
  }
  if (!blk && zs < CFG.slotZ) xs = slotX(zs);
  if (!f || !pad) return { xs, zs, zt: zs, slotRefused: noSlot === 'refused' };
  // (fingers 2-5: the pad's place from the tip joint's, the finger posed with its tip joint there and its knuckle where it
  // is half-way through the hold; without the model, by the pad table at the last bone's angle then)
  const { k: mb, G } = hold ? hold[Math.round(0.5 * (hold.length - 1))] : { k: m, G: F };
  const tip = V(xs, ty, zs), J = solveChain(mb, tip, SEG[f], 1.9, G.ax.y, Q.dip), pz = blk ? [CFG.zoneBlack[f][0], CFG.padBlack] : WIDE(pitch) ? [CFG.padSlot, CFG.padZone[1]] : Q.legacy ? CFG.padZone : [Math.min(CFG.padZone[0], Q.dga - 0.15), CFG.padZone[1]];
  const o = padLowest(f, J.map((q) => G.local(q)), G.local(V(G.O.x, G.O.y + 1, G.O.z)));
  if (o) return { xs, zs: clamp(zs + G.rot(o).z, pz[0], pz[1]), zt: zs, slotRefused: noSlot === 'refused' };
  const fz = (zs - mb.z) / (Math.hypot(xs - mb.x, zs - mb.z) || 1);
  return { xs, zs: clamp(zs - fz * padLookup(f, distalBeta(J)).ahead, pz[0], pz[1]), zt: zs, slotRefused: noSlot === 'refused' };
}

// ---- (posture presets) a finger 2-5 between the black keys: how deep its skin goes into the black keys beside its white
// key (the measure of tools/hand-metrics.mjs: inside a key's box by more than 0.03 counts), with the finger posed by this
// file's IK from knuckle mk to its tip joint at tip (hand frame G). The skin about each bone, measured on the hand model
// (its last bone from the middle joint, s 0, to its end, s 1; its middle bone's middle and ends): [s, across, below the
// bone], as the bone's share of its length and units. The skin's cross-section is taken as the ellipse through them.
const FSKIN = [null,
  { mid: [[0.25, 0.342, 0.347], [0.55, 0.31, 0.346], [0.85, 0.29, 0.293]], tip: [[0.05, 0.296, 0.291], [0.25, 0.295, 0.286], [0.45, 0.285, 0.269], [0.65, 0.264, 0.247], [0.8, 0.24, 0.19], [0.92, 0.205, 0.11], [1.02, 0.12, 0.02], [1.1, 0.08, 0.03]] },
  { mid: [[0.25, 0.363, 0.286], [0.55, 0.348, 0.277], [0.85, 0.33, 0.228]], tip: [[0.05, 0.319, 0.24], [0.25, 0.317, 0.238], [0.45, 0.315, 0.22], [0.65, 0.308, 0.183], [0.8, 0.28, 0.13], [0.92, 0.235, 0.04], [0.98, 0.15, 0.01], [1.1, 0.08, 0.03]] },
  { mid: [[0.25, 0.319, 0.264], [0.55, 0.296, 0.26], [0.85, 0.284, 0.244]], tip: [[0.05, 0.28, 0.229], [0.25, 0.283, 0.239], [0.45, 0.28, 0.234], [0.65, 0.276, 0.202], [0.8, 0.26, 0.16], [0.92, 0.225, 0.08], [1.04, 0.154, 0.01], [1.1, 0.08, 0.03]] },
  { mid: [[0.25, 0.26, 0.238], [0.55, 0.246, 0.222], [0.85, 0.238, 0.198]], tip: [[0.05, 0.244, 0.203], [0.25, 0.24, 0.205], [0.45, 0.233, 0.196], [0.65, 0.218, 0.168], [0.8, 0.203, 0.138], [0.92, 0.18, 0.08], [1.04, 0.117, 0.01], [1.1, 0.08, 0.03]] },
];
const SKIN_ANG = [0, 0.5, 1, 1.35, Math.PI / 2].map((a) => [Math.cos(a), Math.sin(a)]);
// the narrowest narrow part each finger fits into: its last bone at its widest (the measure allows 0.03 on each side, which
// is left to spare)
const FIT_W = [Infinity, 0.592, 0.638, 0.566, 0.488];
const BLACK_FRONT = 3.95;
const BLACKS = [...Array(128).keys()].filter((p) => p >= A0 && p <= C8 && isBlack(p));
// (kb: the black keys to test, by default those beside the white key pitch; skinUp: how far the deepest point found inside
// them lies below their tops)
let skinUp = 0;
function skinInBlack(f, pitch, J, kb = [pitch - 1, pitch + 1].filter((b) => isBlack(b))) {
  let worst = 0; skinUp = 0;
  const seg = (a, b, rows) => {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, L = Math.hypot(dx, dy, dz) || 1, ux = dx / L, uy = dy / L, uz = dz / L;
    // across: horizontal, square to the bone; below: square to the bone and to across, downward
    let sx = -uz, sz = ux; const sl = Math.hypot(sx, sz) || 1; sx /= sl; sz /= sl;
    let nx = sz * uy, ny = -(sz * ux - sx * uz), nz = -sx * uy;   // across x bone
    if (ny > 0) { nx = -nx; ny = -ny; nz = -nz; }
    for (const [s, w, bl] of rows) {
      const px = a.x + dx * s, py = a.y + dy * s, pz = a.z + dz * s;
      if (py - bl > BLACK_TOP || pz - w > BLACK_FRONT) continue;
      for (const [c, sn] of SKIN_ANG) for (const side of [-1, 1]) {
        const x = px + side * sx * w * c + nx * bl * sn, y = py + ny * bl * sn, z = pz + side * sz * w * c + nz * bl * sn;
        if (y >= BLACK_TOP || z >= BLACK_FRONT || z <= 0) continue;
        for (const b of kb) {
          const d = Math.min(LAYOUT.blackW / 2 - Math.abs(x - KX[b]), BLACK_TOP - y, BLACK_FRONT - z, z);
          if (d > worst) worst = d;
          if (d > 0 && BLACK_TOP - y > skinUp) skinUp = BLACK_TOP - y;
        }
      }
    }
  };
  const S = FSKIN[f];
  seg(J[1], J[2], S.mid); seg(J[2], J[3], S.tip);
  return worst;
}

// the descent time of a key struck at velocity v (CFG.dVel, linear between its points)
function dOfVel(v) {
  const T = CFG.dVel;
  if (v <= T[0][0]) return T[0][1];
  for (let i = 1; i < T.length; i++) if (v <= T[i][0]) return T[i - 1][1] + ((v - T[i - 1][0]) / (T[i][0] - T[i - 1][0])) * (T[i][1] - T[i - 1][1]);
  return T[T.length - 1][1];
}
const smoothstep = (a, b, x) => ease((x - a) / (b - a));
const now = () => (globalThis.performance ? performance.now() : Date.now());

// opts.posture: 'auto' (the default), 'lyrical', 'classical', or 'legacy' (the posture before the setting; for comparison);
// opts.keyLayout: the black keys' layout (KEY_LAYOUTS: 'piano', the default, or 'even'), set for the whole module
export function createHands(piece, handOf, opts = {}) {
  const t0 = now();
  const keyLayout = setKeyLayout(opts.keyLayout);
  const notes = piece ? piece.notes.filter((n) => n.pitch >= A0 && n.pitch <= C8) : [];
  const plan = planHands(notes, handOf);
  const fallbackX = [KX[67], KX[48]];

  // ---- the hand's posture over time (POSTURE above): per hand, steps of its classical, black and chord weights, one
  // per event (held until the next), smoothed when they are read (PQ). Lyrical and Classical fix the classical weight.
  const posture = ['lyrical', 'classical', 'legacy'].includes(opts.posture) ? opts.posture : 'auto', LEG = posture === 'legacy', PG = 0.02;
  const PW = plan.map((H) => {
    const ev = H.events;
    if (LEG || !ev.length) return null;
    const PS = POSTURE, val = ev.map((e, i) => {
      const d = []; for (let j = Math.max(0, i - 4); j < Math.min(ev.length - 1, i + 4); j++) d.push(ev[j + 1].t - ev[j].t);
      d.sort((a, b) => a - b);
      const r = 1 / clamp(d.length ? d[d.length >> 1] : 1, 0.05, 2);
      let n = 0, v = 0, b = 0;
      const add = (q) => { for (const m of q.notes) { n++; v += m.vel ?? 0.7; if (isBlack(m.pitch)) b++; } };
      for (let j = i; j >= 0 && ev[j].t >= e.t - PS.near; j--) add(ev[j]);
      for (let j = i + 1; j < ev.length && ev[j].t <= e.t + PS.near; j++) add(ev[j]);
      // (the front weight: 1 at an event where a finger 2-5 plays a white key it does not fit into between the black keys:
      // its last bone wider than that key's narrow part allows (FIT_W), or its knuckle, by the event's anchor, more than
      // PS.slant across from that narrow part's middle)
      // (as long as that note lasts)
      let fr = -Infinity;
      e.notes.forEach((m, k) => { const f = e.fs[k]; if (!f || isBlack(m.pitch)) return; const c = KX[m.pitch] + SLOT[m.pitch % 12]; if (FIT_W[f] > SLOTW[m.pitch % 12] || Math.abs(c - (e.anchor + H.side * MCP_L[f][0])) > PS.slant) fr = Math.max(fr, e.t + m.dur); });
      return [clamp(smoothstep(PS.rate[0], PS.rate[1], r) + PS.loud[2] * smoothstep(PS.loud[0], PS.loud[1], n ? v / n : 0.7), 0, 1),
        smoothstep(PS.black[0], PS.black[1], n ? b / n : 0), e.notes.length >= 3 ? 1 : 0, fr];
    });
    // each weight held from its event to the next (the first one before it, the last after it), smoothed by a Gaussian
    // of sig s on a grid of PG s (read between its points by a Catmull-Rom cubic: smooth, a pure function of t)
    const t0 = ev[0].t - 3, n = Math.ceil((ev[ev.length - 1].t + 3 - t0) / PG) + 1;
    return [0, 1, 2, 3].map((q) => {
      if (q === 0 && posture !== 'auto') return null;
      const sig = [PS.sigW, PS.sigK, PS.sigC, PS.sigF][q], raw = new Float64Array(n);
      if (q === 3) { H.frontIv = ev.map((e, j) => [e.t, val[j][3]]).filter(([a, b]) => b > a); return frontGrid(H.frontIv, t0, n); }
      for (let i = 0, j = 0; i < n; i++) { const t = t0 + i * PG; while (j + 1 < ev.length && ev[j + 1].t <= t) j++; raw[i] = val[j][q]; }
      const r = Math.ceil((4 * sig) / PG), ker = Float64Array.from({ length: 2 * r + 1 }, (_, m) => Math.exp(-0.5 * (((m - r) * PG) / sig) ** 2)), ks = ker.reduce((a, b) => a + b, 0);
      const v = new Float64Array(n);
      for (let i = 0; i < n; i++) { let a = 0; for (let m = -r; m <= r; m++) a += ker[m + r] * raw[i + m < 0 ? 0 : i + m >= n ? n - 1 : i + m]; v[i] = a / ks; }
      return { t0, n, v, lead: [PS.leadW, PS.leadK, PS.leadC, PS.leadF][q] };
    });
  });
  // the front weight's grid from its stretches [from, to] (1 within them), smoothed as the others
  function frontGrid(iv, t0, n) {
    const PS = POSTURE, raw = new Float64Array(n), sig = PS.sigF;
    for (const [a, b] of iv) for (let i = Math.max(0, Math.floor((a - t0) / PG)), e = Math.min(n - 1, Math.ceil((b - t0) / PG)); i <= e; i++) raw[i] = 1;
    const r = Math.ceil((4 * sig) / PG), ker = Float64Array.from({ length: 2 * r + 1 }, (_, m) => Math.exp(-0.5 * (((m - r) * PG) / sig) ** 2)), ks = ker.reduce((a, b) => a + b, 0);
    const v = new Float64Array(n);
    for (let i = 0; i < n; i++) { let a = 0; for (let m = -r; m <= r; m++) a += ker[m + r] * raw[i + m < 0 ? 0 : i + m >= n ? n - 1 : i + m]; v[i] = a / ks; }
    return { t0, n, v, lead: PS.leadF };
  }
  // (after a pass of strikes: each white key a finger 2-5 was refused between the black keys, for its whole hold, too;
  // true when that adds a stretch)
  const frontFromRefused = () => {
    if (LEG) return false;
    let changed = false;
    plan.forEach((H, h) => {
      const S = PW[h]; if (!S) return;
      const add = [];
      for (let f = 1; f < 5; f++) for (const p of H.presses[f]) if (p.noSlot && !isBlack(p.pitch) && !p.frontIv) { p.frontIv = true; add.push([p.tc - 0.05, p.off + p.ride]); }
      if (!add.length) return;
      H.frontIv.push(...add); S[3] = frontGrid(H.frontIv, S[3].t0, S[3].n); changed = true;
    });
    if (changed) { pqMemo[0].clear(); pqMemo[1].clear(); pqFull[0].clear(); pqFull[1].clear(); for (const H of plan) for (const pr of H.presses) for (const p of pr) delete p.postQ; }
    return changed;
  };
  const gridAt = (G, t) => {
    const u = (t + G.lead - G.t0) / PG, v = G.v, n = G.n;
    if (u <= 0) return v[0]; if (u >= n - 1) return v[n - 1];
    const i = Math.floor(u), f = u - i, p0 = v[i > 0 ? i - 1 : 0], p1 = v[i], p2 = v[i + 1], p3 = v[i + 2 < n ? i + 2 : n - 1];
    return clamp(p1 + 0.5 * f * (p2 - p0 + f * (2 * p0 - 5 * p1 + 4 * p2 - p3 + f * (3 * (p1 - p2) + p3 - p0))), 0, 1);
  };
  // hand h's posture at t (lean: only its knuckles' place and its pitch)
  // (the lean ones remembered by time: the plan asks for the same moments many times)
  const pqMemo = [new Map(), new Map()], pqFull = [new Map(), new Map()];
  const PQ = (h, t, lean = false) => {
    if (LEG) return LEGACY_Q;
    const M = (lean ? pqMemo : pqFull)[h]; let q = M.get(t);
    if (q === undefined) { if (M.size > 2e5) M.clear(); q = PQf(h, t, lean); M.set(t, q); }
    return q;
  };
  const PQf = (h, t, lean) => {
    const S = PW[h], wFix = posture === 'classical' ? 1 : 0;
    if (!S) return blendPosture(wFix, 0, 0, lean);
    return blendPosture(S[0] ? gridAt(S[0], t) : wFix, gridAt(S[1], t), gridAt(S[2], t), lean, gridAt(S[3], t));
  };
  // how far forward hand h must come at t for finger f on a black key, and on a white key (CFG.ZNEED for the posture's
  // knuckle depth)
  const needB = (h, f, t) => (LEG ? CFG.ZNEED_BLACK[f] : Math.max(0, PQ(h, t, true).Z0 - ZABS_BLACK[f]));
  const needW = (h, f, t) => (LEG ? CFG.ZNEED_WHITE[f] : Math.max(0, PQ(h, t, true).Z0 - ZABS_WHITE[f]));
  // each press's posture (at its key's bottom), worked out once
  const pqOf = (p) => p.postQ || (p.postQ = PQ(p.hand, p.onKey));

  // ---- press timing (FINAL-SPEC S2.1). Each press's key reaches the bottom at onKey, the onset (a leap may arrive up to
  // LATE_MAX late: below); the fingertip meets the key d s before (tc). d comes from the note's loudness, but stays within
  // dShare of the time since this finger let go of its last key and since this key was last let go (a key still held by
  // another press at this onset stays down). (The releases here are planHands' (the note's end, this finger's next key,
  // the key struck again, the fingering's next hand place); the path's releases below only make them earlier, so d stays
  // within its share.)
  // (S5) A key struck by both hands at once (the same pitch, onsets within 35 ms, as fingering.js's events) goes down once:
  // one hand plays it, and the other hand's note is played by that press (its dups), so nothing goes unplayed and the
  // other finger stays free. Two thumbs on the one key, one in front of the other, went into each other: Wedding Day
  // 161.3 s, A3 in both hands. The hand that plays it: the one whose own notes around it (within 0.3 s, but not at once)
  // lie nearer, so the figure it belongs to keeps it (kept by the right hand, Moonlight's E4 at 294.36 s left the left
  // hand's rising arpeggio without its top, and the hand jolted); then the longer note; then the right hand.
  let unisons = 0;
  {
    const byP = new Map(), mine = plan.map((H) => H.presses.flat().sort((a, b) => a.on - b.on));
    const near = (h, p) => {
      const L = mine[h]; let s = 0, n = 0;
      for (const q of L) { if (q.on < p.on - 0.3) continue; if (q.on > p.on + 0.3) break; if (Math.abs(q.on - p.on) >= 0.035) { s += Math.abs(KX[q.pitch] - KX[p.pitch]); n++; } }
      return n ? s / n : Infinity;
    };
    plan.forEach((H, h) => H.presses.forEach((pr) => pr.forEach((p) => { if (!byP.has(p.pitch)) byP.set(p.pitch, []); byP.get(p.pitch).push(p); })));
    const gone = new Set();
    for (const L of byP.values()) {
      L.sort((a, b) => a.on - b.on || a.hand - b.hand);
      for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length && L[j].on - L[i].on < 0.035; j++) {
        const a = L[i], b = L[j];
        if (a.hand === b.hand || gone.has(a) || gone.has(b)) continue;
        const na = near(a.hand, a), nb = near(b.hand, b);
        const bFirst = Math.abs(na - nb) > 0.5 ? nb < na : b.note.dur !== a.note.dur ? b.note.dur > a.note.dur : b.hand < a.hand;
        const [keep, drop] = bFirst ? [b, a] : [a, b];
        (keep.dups ||= []).push(drop.note, ...(drop.dups || []));
        gone.add(drop); unisons++;
      }
    }
    if (gone.size) plan.forEach((H) => { H.presses = H.presses.map((pr) => pr.filter((p) => !gone.has(p))); });
  }
  let all = [];
  plan.forEach((H, h) => H.presses.forEach((pr, f) => pr.forEach((p, i) => {
    Object.assign(p, { hand: h, f, vel: p.note.vel ?? 0.7, late: 0, gapF: i ? p.on - pr[i - 1].off : Infinity });
    all.push(p);
  })));
  {
    const byP = new Map();
    for (const p of all) { if (!byP.has(p.pitch)) byP.set(p.pitch, []); byP.get(p.pitch).push(p); }
    for (const L of byP.values()) {
      L.sort((a, b) => a.on - b.on || a.hand - b.hand || a.f - b.f);
      L.forEach((p, i) => {
        let last = -Infinity;
        for (let j = i - 1; j >= Math.max(0, i - 8); j--) if (L[j].off <= p.on && L[j].off > last) last = L[j].off;
        const gap = Math.min(p.gapF, p.on - last);
        p.d = Math.max(1e-4, clamp(dOfVel(p.vel), CFG.dMin, CFG.dShare * gap));
        p.onKey = p.on + p.late; p.tc = p.onKey - p.d;
        delete p.gapF;
      });
    }
  }

  // ---- the hand's path across the keys (FINAL-SPEC S4). Each event's practical window (lo..hi: the anchors from which
  // every one of its keys is within its finger's practical reach, with the key's slack) is where the hand must be while
  // its keys are struck; winU(p) is press p's own (its finger alone), for the hold window and the release, in the hand's
  // own lateral coordinate u (planPath).
  const winU = (p, band = null) => {
    const B = band || BANDS[p.post][p.f], sl = slackOf(p.f, p.pitch), u = plan[p.hand].side > 0 ? KX[p.pitch] : MIR - KX[p.pitch], r = REST[p.f];
    return [u - r - B[1] - sl, u - r - B[0] + sl];
  };
  const leaps = { droppedLeap: [0, 0], late: [0, 0], lunge: [0, 0], arrive: [0, 0], rolled: [0, 0], forward: [0, 0], leaned: [0, 0] };
  plan.forEach((H, h) => {
    const ev = H.events;
    for (const e of ev) e.pr = [];
    H.presses.forEach((pr) => pr.forEach((p, i) => { p.idx = i; ev[p.ev].pr.push(p); }));
    for (const e of ev) {
      e.tc = Infinity; e.onKey = -Infinity; e.dur = 0;
      for (const p of e.pr) { e.tc = Math.min(e.tc, p.tc); e.onKey = Math.max(e.onKey, p.onKey); e.dur = Math.max(e.dur, p.note.dur); }
      Object.assign(e, { wlo: e.lo, whi: e.hi, lunge: 0, dwell: 0, late: 0, leap: false, hurry: false, leapDrop: false });
      e.plo = e.wlo; e.phi = e.whi;           // (the path's window before any lunge widens it)
    }
    // (In the spread posture S the path prefers, by a stiff comfort window, where the thumb reaches as the hand is actually
    // posed (SREAL: its normal reach), where its event's keys and those of the events within sRealNear s allow it. S's own
    // thumb band, 1.4 beyond its rest place, assumes the hand turned 10 deg toward its little finger and lower, which waits
    // for S6's channels; with it the path put Fur Elise's and Bach's right hands where the thumb fell up to 1.7 short of its
    // key. Without the neighbours' windows it pulled the hand toward the thumb in broken octaves, and Moonlight's left little
    // finger was stretched straight at 131-149 s. Measured, IK miss at contact p95, right hand: Fur Elise 0.63 -> 0.27,
    // Bach 0.83 -> 0.75.)
    if (PATH.sReal) ev.forEach((e, i) => {
      if (e.post !== 'S' || !e.pr.some((p) => p.f === 0)) return;
      let lo = -Infinity, hi = Infinity;
      for (const p of e.pr) { const B = SREAL[p.f], sl = slackOf(p.f, p.pitch), u = H.side > 0 ? KX[p.pitch] : MIR - KX[p.pitch], r = REST[p.f]; lo = Math.max(lo, u - r - B[1] - sl); hi = Math.min(hi, u - r - B[0] + sl); }
      let [a, b] = H.side > 0 ? [lo, hi] : [MIR - hi, MIR - lo];
      a = Math.max(a, e.plo); b = Math.min(b, e.phi);
      for (const j of [-1, 1]) for (let q = i + j; q >= 0 && q < ev.length && Math.abs(ev[q].t - e.t) <= PATH.sRealNear; q += j) if (ev[q].pr.length) { a = Math.max(a, ev[q].plo); b = Math.min(b, ev[q].phi); }
      if (a > b) return;
      e.pclo = Math.max(e.clo, a); e.pchi = Math.min(e.chi, b);
      if (e.pclo > e.pchi) { e.pclo = a; e.pchi = b; }
    });
    // (fingers round 1) A chord wider than the hand reaches (the fingering's stretched chords: their keys' bands leave no
    // anchor, rollMin or more short of one) is rolled, from the bass up, as a pianist rolls a tenth: its lower keys, the most
    // that fit the hand together, are struck rollEarly s early, the rest rollLate s late (the key, not the sound, each within
    // what is not noticed), and the hand moves between the two (e.roll: each part's window, in the world). The lower keys
    // then let go as the hand moves on (the pedal holds them). Struck together, both ends of the chord were stretched
    // straight toward keys out of reach: Cornfield Chase's left hand on G2+D3+B3 at 72.72 s, its little finger and thumb
    // 1.05 and 0.68 short; its right hand's tenths F4+A4+A5 every 3.8 s.
    for (const e of ev) {
      if (!e.stretched || e.pr.length < 2) continue;
      const fit = (L) => { let lo = -Infinity, hi = Infinity; for (const p of L) { const [a, b] = winU(p); lo = Math.max(lo, a); hi = Math.min(hi, b); } return [lo, hi]; };
      const [l0, h0] = fit(e.pr);
      if (l0 - h0 < PATH.rollMin) continue;
      const S = e.pr.slice().sort((a, b) => a.pitch - b.pitch || a.f - b.f);
      let n = 1; while (n < S.length && (() => { const [a, b] = fit(S.slice(0, n + 1)); return a - b <= PATH.rollFit; })()) n++;
      if (n >= S.length) continue;
      const A = S.slice(0, n), B = S.slice(n);
      // (early only as far as each lower finger's last release allows)
      let early = PATH.rollEarly;
      for (const p of A) { const q = H.presses[p.f][p.idx - 1]; if (q) early = Math.min(early, Math.max(0, p.tc - Math.max(q.off, q.on + 0.05) - 0.03)); }
      for (const p of A) { p.onKey -= early; p.tc -= early; }
      // (the upper keys are met only rollMove s after the lower ones reach the bottom, the hand moving between: a soft chord's
      // slow descent, up to 0.17 s, would have them met before; they go down faster)
      const onA = Math.max(...A.map((p) => p.onKey));
      for (const p of B) { p.late = PATH.rollLate; p.onKey = p.on + p.late; p.d = clamp(p.onKey - onA - PATH.rollMove, CFG.dMin, p.d); p.tc = p.onKey - p.d; }
      // (a lower key whose finger does not reach it from the upper part's place lets go as soon as it is at the bottom)
      const [bl, bh] = fit(B);
      for (const p of A) { const [a, b] = winU(p); if (a > bh + PATH.leave || b < bl - PATH.leave) { p.rollOff = p.onKey + PATH.hurryHold; p.floor = Math.min(p.floor, p.rollOff); } }
      const W = (L) => { const [a, b] = fit(L); return H.side > 0 ? [a, b] : [MIR - b, MIR - a]; };
      const tcOf = (L) => Math.min(...L.map((p) => p.tc)), okOf = (L) => Math.max(...L.map((p) => p.onKey));
      e.roll = { A: W(A), B: W(B), tcA: tcOf(A), onA: okOf(A), tcB: tcOf(B), onB: okOf(B) };
      e.tc = Math.min(e.roll.tcA, e.roll.tcB); e.onKey = Math.max(e.roll.onA, e.roll.onB);
      leaps.rolled[h]++;
    }
    // Leaps (S4.2): consecutive events whose windows are more than leapGap apart (g). The hand has A s, from the end of
    // the last strike window to the new contact. Minimum-jerk, its peak speed is 1.875 g / A: within vCap it flies, and
    // arrives dwell s early when there is time (the hard window then starts at tc - dwell); else the fingers lead by up to
    // `lunge` (the new window widened toward the old place); else, lunging, the event is struck up to lateMax late (its
    // contact and key, not its sound); else its strike is dropped (counted) and the next event is reached from the old place.
    // (lateFirst: a strike up to lateMax late without lunging comes before lunging. This rig's reach bands are already the
    // fingers' limits, so a lunge leaves the finger short of its key as the key goes down: the Revolutionary's left thumb
    // was half a key short of E-flat4 at 48.10 s. A key up to 0.04 s behind its sound is not noticed (FINAL-SPEC A3).)
    let P = null;
    for (const e of ev) {
      if (!e.pr.length) continue;
      if (!P) { P = e; continue; }
      let g = Math.max(0, e.plo - P.phi, P.plo - e.phi);
      let A = e.tc - (P.onKey + PATH.strikePost);
      // (the last strike before a tight leap is made from above its keys: on the side the hand leaves for, its window ends
      // where its fingers are within their comfortable reach of the normal posture N (unless it is itself a lunge). From the
      // practical window's edge, a finger at the edge of its reach struck straight, reaching back, as the hand set off: Op. 25's
      // left little finger on A-flat1 at 0.55 s, PIP 0. Not where that would make the leap one to drop.)
      if (g > PATH.leapGap && !P.lunge && (1.875 * g) / PATH.vCap > A) {
        let lo = -Infinity, hi = Infinity;
        for (const p of P.pr) { const [a, b] = winU(p, COMFORTS.N[p.f]), [wa, wb] = H.side > 0 ? [a, b] : [MIR - b, MIR - a]; lo = Math.max(lo, wa); hi = Math.min(hi, wb); }
        const up = e.plo > P.phi, edge = up ? clamp(hi, P.plo, P.phi) : clamp(lo, P.plo, P.phi);
        const g2 = up ? Math.max(0, e.plo - edge) : Math.max(0, edge - e.phi);
        if ((1.875 * (g2 - PATH.lunge)) / PATH.vCap - (A + PATH.strikePost) <= PATH.lateMax) {
          if (up) P.whi = P.phi = edge; else P.wlo = P.plo = edge;
          g = g2;
        }
      }
      if (g > PATH.leapGap) {
        const vc = PATH.vCap, dir = e.plo > P.phi ? 1 : -1;
        e.leap = true;
        // (a leap with no time to spare sets off as the last key before it reaches the bottom (hurry), not strikePost later: the
        // hand bounces off it, as a pianist's does. S4: the Revolutionary's left hand leaps from C2 to E-flat4 in 0.094 s
        // at 48.0 s, 49.5 s and 51.0 s, 0.004-0.02 s beyond lunging and lateMax.)
        if ((1.875 * g) / vc > A) { P.hurry = true; A += PATH.strikePost; }
        // (late only when each of its fingers can still hold its key 0.02 s before that finger's next contact)
        const canLate = (late) => e.pr.every((p) => { const q = H.presses[p.f][p.idx + 1]; return !q || q.tc - 0.01 >= p.on + late + 0.02; });
        const lateFull = (1.875 * g) / vc - A, lateLunge = (1.875 * (g - PATH.lunge)) / vc - A;
        let late = 0;
        if (lateFull <= 0) {
          e.dwell = Math.min(0.04, A - Math.min(A, clamp(0.12 + 0.02 * (g + 1), 0.12, 0.45))); leaps.arrive[h]++;
        } else if (PATH.lateFirst && lateFull <= PATH.lateMax && canLate(lateFull)) {
          // (S4 fix: a strike that is late anyway after a hurried departure is at least hurryLate late when its fingers allow:
          // planned at exactly vCap, the flight left the last key before it reached the bottom (the path cannot fly a
          // minimum-jerk leap that short), and its finger was left stretched back on it: Op. 25's left little finger on
          // A-flat1 at 0.56-0.58 s, late 0.001 for E-flat3)
          late = lateFull;
          if (P.hurry && PATH.hurryLate > lateFull) { const l2 = Math.min(PATH.lateMax, PATH.hurryLate); if (canLate(l2)) late = l2; }
        } else if (PATH.lateFirst && canLate(PATH.lateMax) && g - (vc * (A + PATH.lateMax)) / 1.875 <= PATH.lunge) {
          // (S4 fix: as late as allowed, and only the lunge that is still needed then. This rig's bands are the fingers'
          // limits, so the finger that leads a lunge falls short by the lunge: lunging a whole unit and late 0.037 s, the
          // Revolutionary's left thumb missed E-flat4 at 48.11 s by 1.7 sideways)
          late = PATH.lateMax; e.lunge = Math.max(0, g - (vc * (A + late)) / 1.875);
          if (e.lunge > 0) leaps.lunge[h]++;
        } else if (lateLunge <= 0) {
          e.lunge = Math.min(PATH.lunge, g - (vc * A) / 1.875); leaps.lunge[h]++;
        } else {
          // (within 1 ms of lateMax counts as lateMax: the Revolutionary's left hand at 51.09 s needs 0.04001 s)
          late = Math.min(lateLunge, PATH.lateMax);
          if (!(lateLunge <= PATH.lateMax + 1e-3 && canLate(late))) { e.leapDrop = true; leaps.droppedLeap[h]++; continue; }
          e.lunge = PATH.lunge; leaps.lunge[h]++;
        }
        if (late > 0) {
          e.late = late; leaps.late[h]++;
          for (const p of e.pr) { p.late += late; p.onKey += late; p.tc += late; }
          if (e.roll) for (const k of ['tcA', 'onA', 'tcB', 'onB']) e.roll[k] += late;
          e.tc += late; e.onKey += late;
        }
        if (e.lunge) { if (dir > 0) e.wlo -= e.lunge; else e.whi += e.lunge; }
      }
      P = e;
    }
    // (a dropped strike's notes are not played: no finger, no key)
    if (leaps.droppedLeap[h]) H.presses = H.presses.map((pr) => pr.filter((p) => !ev[p.ev].leapDrop));
    H.presses.forEach((pr) => pr.forEach((p, i) => {
      const q = pr[i + 1];
      // (this finger's next contact: it lets go min(0.04, 0.45 of the time to it) before it, FINAL-SPEC S4.4)
      p.offNextTc = q ? q.tc - Math.min(0.04, 0.45 * (q.tc - p.on)) : Infinity;
      if (p.late) p.floor = Math.max(p.floor, p.onKey + 0.02);
      // (a strike that a tight leap leaves from lets go as its key reaches the bottom: held its usual 0.05 s, the finger was
      // left on it, stretched straight out after the hand: the Revolutionary's right thumb on G4 at 5.93 s)
      if (ev[p.ev].hurry) { p.floor = Math.min(p.floor, p.onKey + PATH.hurryHold); p.capTail = 0; }
    }));
  });
  all = all.filter((p) => !plan[p.hand].events[p.ev].leapDrop);
  const tPath = now();
  let pathIters = 0, pathUnsettled = 0;
  // ---- two hands (FINAL-SPEC S5). Each hand's path alone (S4), then the separation re-solve: the right hand with the
  // left hand's path as a stiff one-sided window (x_R >= x_L + G), then the left hand with the right's (x_L <= x_R - G),
  // sepRounds times, each from the solution before (warm start). G is gThumbs while either thumb is on its key or
  // near a press (their muscles face each other), gPalm otherwise. (This replaces S4's stand-in, the left hand's room
  // from the right hand's path, and before it the per-frame push, which dragged a crossing left hand back onto the right
  // hand: tools/out/view/feedback1/hands-overlap.md.)
  // Where both hands' strike windows leave the knuckles less than crossGap apart (a written crossing: a hand plays among
  // or beyond the other's keys), there is no bound: it is a crossing interval, while the hands' own paths are that close,
  // padded by crossPad. One hand crosses (playing from above and further in; offsetAt below): the one that moved into the
  // other's side last (hands-overlap.md section 5, design-fingering.md 6.5: a leap or a long held note crosses, a running
  // figure stays put); on a tie the one with fewer notes in it.
  const liveOf = (H) => H.events.filter((e) => e.pr.length && !e.leapDrop);
  let range = null;
  if (plan.every((H) => liveOf(H).length)) {
    range = [Infinity, -Infinity];
    for (const H of plan) for (const e of liveOf(H)) { range[0] = Math.min(range[0], e.tc); for (const p of e.pr) range[1] = Math.max(range[1], p.on + p.note.dur, p.off); }
  }
  const PB = plan.map((H, h) => pathProblem(H.side, liveOf(H), winU, fallbackX[h], range));
  const sol = PB.map((P) => solveProblem(P));
  const xOf = (h, t) => { const P = PB[h], v = bspline(sol[h].u, P.T0, P.dt, t); return P.side > 0 ? v : MIR - v; };
  const crossings = [];
  // (the shared time grid: t = gT0 + i dt)
  const both = !PB[0].empty && !PB[1].empty, dtg = PATH.dt;
  const gT0 = both ? Math.min(PB[0].T0, PB[1].T0) : 0, gN = both ? Math.ceil((Math.max(PB[0].T0 + PB[0].N * dtg, PB[1].T0 + PB[1].N * dtg) - gT0) / dtg) + 1 : 0;
  const gi = (t) => clamp(Math.round((t - gT0) / dtg), 0, Math.max(0, gN - 1));
  const sepG = new Float64Array(gN), crossK = new Uint8Array(gN), thumbUse = [new Float64Array(gN), new Float64Array(gN)];
  if (both) {
    // G: how much the thumbs are in use (1 on a key, falling to 0 thumbNear s from a press), the greater of the two (the
    // spec's "both thumbs", the lesser, gave Op. 25's right hand jolts, 0 -> 2.1 per minute, and no fewer overlaps)
    const use = plan.map((H) => {
      const u = new Float64Array(gN), n = Math.round(PATH.thumbNear / dtg);
      for (const p of H.presses[0]) {
        if (H.events[p.ev].leapDrop) continue;
        const i0 = gi(p.tc), i1 = gi(p.off);
        for (let i = Math.max(0, i0 - n); i <= Math.min(gN - 1, i1 + n); i++) u[i] = Math.max(u[i], i < i0 ? 1 - (i0 - i) / n : i > i1 ? 1 - (i - i1) / n : 1);
      }
      return u;
    });
    for (let i = 0; i < gN; i++) sepG[i] = PATH.gPalm + (PATH.gThumbs - PATH.gPalm) * Math.max(use[0][i], use[1][i]);
    thumbUse[0] = use[0]; thumbUse[1] = use[1];
    // the crossings: knots where both hands' windows (in world x) leave the knuckles less than crossGap apart. A hand's
    // window there is its strike window, and that of any key it holds on under its own later strikes or for long (sus,
    // Liszt's Consolation 3 at 175.3 s: the right hand's F4, held 1 s, under the left hand's A flat 4): such a key
    // holds the hand as surely as a strike (Wedding Day 163.3 s: the right hand holds G3 + B3 under its melody while the
    // left crosses over it to D5; by the strike windows alone that was no crossing, and the stiff bound carried the right
    // hand 13 keys off its keys). (Not every held key: Fur Elise's shared E-D sharp figure, 16.9-19.2 s, where the right
    // hand's last E5 is held while the left strikes beside it, is played better side by side, the note let go.) ...
    const hardX = (h, t) => {
      const P = PB[h], k = Math.round((t - P.T0) / P.dt);
      if (k < 1 || k > P.N - 2) return null;
      let lo = -Infinity, hi = Infinity, any = false;
      for (const W of [P.hard, P.sus]) if (W.w[k] > 0) { lo = Math.max(lo, W.lo[k]); hi = Math.min(hi, W.hi[k]); any = true; }
      if (!any || lo > hi) return null;
      return P.side > 0 ? [lo, hi] : [MIR - hi, MIR - lo];
    };
    // ... or where the hands' own paths are crossed by more than crossGap (the right hand's knuckle that far left of the
    // left hand's) while both play, with a window within crossNear s: a hand-over-hand passage, where one hand's strikes
    // follow the other's beyond it
    // (Mozart's Fantasia 126.0 s: the right hand's little finger leaves A3 as the left hand's comes down on C4, its windows
    // never at the same time as the right hand's; the stiff bound then flung the right hand 14 keys in 0.3 s). (An idle hand
    // in the way, with no window near, is no crossing: the bound moves it aside; so are paths crossed by less, as Fur
    // Elise's E-D sharp figure shared by the hands on the same two keys, 16.9-19.2 s: side by side, the bound parts them.)
    // (Both only where the hands' own paths are close enough for the bound to act.)
    const nN = Math.round(PATH.crossNear / dtg), has = [0, 1].map((h) => {
      const a = new Uint8Array(gN);
      for (let i = 0; i < gN; i++) if (hardX(h, gT0 + i * dtg)) for (let j = Math.max(0, i - nN); j <= Math.min(gN - 1, i + nN); j++) a[j] = 1;
      return a;
    });
    const forced = [];
    for (let i = 0; i < gN; i++) {
      const t = gT0 + i * dtg, r = hardX(0, t), l = r && hardX(1, t);
      const g = xOf(0, t) - xOf(1, t);
      if (g < sepG[i] + 0.5 && ((l && r[1] - l[0] < PATH.crossGap) || (has[0][i] && has[1][i] && g < -PATH.crossGap))) forced.push(i);
    }
    // ... grown to while the hands' own paths are closer than the bound would allow (G + 0.5: where it would act), then
    // padded and merged. (Grown only while closer than crossGap, the bound held the crossing hand back up to there, and it
    // then had to leap the rest at once: Interstellar's left hand to E4.)
    const iv = [];
    for (const i of forced) {
      if (iv.length && i <= iv[iv.length - 1][1]) continue;
      const close = (j) => xOf(0, gT0 + j * dtg) - xOf(1, gT0 + j * dtg) < sepG[j] + 0.5;
      let a = i, b = i;
      while (a > 0 && close(a - 1)) a--;
      while (b < gN - 1 && close(b + 1)) b++;
      iv.push([a, b, i]);
    }
    const pad = Math.round(PATH.crossPad / dtg);
    for (const [a, b, f] of iv) {
      const a2 = Math.max(0, a - pad), b2 = Math.min(gN - 1, b + pad), l = crossings[crossings.length - 1];
      if (l && a2 <= l.i1 + 1) { l.i1 = Math.max(l.i1, b2); l.core.push([a, b, f]); } else crossings.push({ i0: a2, i1: b2, core: [[a, b, f]] });
    }
    for (const c of crossings) {
      for (let i = c.i0; i <= c.i1; i++) crossK[i] = 1;
      c.t0 = gT0 + c.i0 * dtg; c.t1 = gT0 + c.i1 * dtg;
      // which hand crosses: the one that moves into the other's side, measured as how far its own path travels across the
      // keys over the crossing (a leap or a hand brought over for a held note crosses; a running figure that stays in
      // place does not; hands-overlap.md section 5's correction of FINAL-SPEC S5.3, whose "newest strike" picked the
      // right hand's ostinato in Interstellar); within crossTie of each other, the one with fewer notes in it
      const trav = [0, 1].map((h) => { let s = 0; for (let i = c.i0; i < c.i1; i++) s += Math.abs(xOf(h, gT0 + (i + 1) * dtg) - xOf(h, gT0 + i * dtg)); return s; });
      const nIn = plan.map((H) => H.events.reduce((n, e) => n + (e.pr.length && !e.leapDrop && e.t >= c.t0 && e.t <= c.t1 ? e.pr.length : 0), 0));
      c.hand = Math.max(...trav) > PATH.crossTie * Math.min(...trav) ? (trav[1] > trav[0] ? 1 : 0) : nIn[1] <= nIn[0] ? 1 : 0;
      c.minGap = Infinity; for (let i = c.i0; i <= c.i1; i++) c.minGap = Math.min(c.minGap, xOf(0, gT0 + i * dtg) - xOf(1, gT0 + i * dtg));
      // (S5 fix) Hand over hand: where the hands' own paths pass each other in a crossing, the hand that passes is the one
      // that moves further across the keys about the pass (crossPassW s each side; within crossTie, neither). Where both
      // hands pass in turn (an arpeggio climbing hand over hand: Mozart's Fantasia 125.3-126.7 s and 212.5-213.9 s, each
      // hand leaving its four notes and going over the other to the next four), the crossing hand is the one that passes
      // first. (By travel over the whole crossing, the right hand was lifted 4.5 while its thumb played C3 under the left
      // hand passing over it, and its thumb hung down onto the left hand's knuckles. Each passing hand above in turn, or
      // only while in the air, could not be kept from touching: where one lands and the other sets off from the same place,
      // the second one's forearm went through the first hand, 14-46 frames.)
      const gAt = (i) => xOf(0, gT0 + i * dtg) - xOf(1, gT0 + i * dtg), passes = [];
      for (let i = c.i0; i < c.i1; i++) {
        if ((gAt(i) < 0) === (gAt(i + 1) < 0)) continue;
        const t = gT0 + (i + 0.5) * dtg, w = PATH.crossPassW, d = [0, 1].map((h) => Math.abs(xOf(h, t + w) - xOf(h, t - w)));
        const hp = d[0] > PATH.crossTie * d[1] ? 0 : d[1] > PATH.crossTie * d[0] ? 1 : -1;
        if (hp >= 0) passes.push([t, hp]);
      }
      if (passes.some((q) => q[1] !== passes[0][1])) c.hand = passes[0][1];
    }
    // the separation re-solve. (Where only one hand holds or strikes a key, the other, idle hand gives way: the bound on
    // the playing hand is wSepYield times as stiff. Solved right hand first with the bound as stiff for both, a right hand
    // holding a 3 s chord was carried off it by a silent left hand: Liszt's Consolation 3 at 239 s.)
    const eng = [0, 1].map((h) => {
      const P = PB[h], a = new Uint8Array(gN);
      for (let i = 0; i < gN; i++) { const k = Math.round((gT0 + i * dtg - P.T0) / P.dt); if (k >= 0 && k < P.N && (P.hard.w[k] > 0 || P.windows[2].w[k] > 0 || P.sus.w[k] > 0)) a[i] = 1; }
      return a;
    });
    for (let r = 0; r < PATH.sepRounds; r++) for (const h of [0, 1]) {
      const P = PB[h], lo = new Float64Array(P.N), hi = new Float64Array(P.N).fill(Infinity), w = new Float64Array(P.N);
      for (let k = 0; k < P.N; k++) {
        const t = P.T0 + k * P.dt, i = gi(t);
        if (crossK[i]) continue;
        lo[k] = h === 0 ? xOf(1, t) + sepG[i] : MIR - xOf(0, t) + sepG[i];
        w[k] = PATH.wSep * (eng[h][i] && !eng[1 - h][i] ? PATH.wSepYield : 1);
      }
      const S = solveProblem(P, [{ lo, hi, w }], sol[h].u);
      sol[h] = S;
      pathIters = Math.max(pathIters, S.iters); pathUnsettled += S.unsettled;
    }
  }
  plan.forEach((H, h) => {
    const P = PB[h], u = sol[h].u;
    // (curves.x: the control points in world x; u: in the hand's own coordinate, which xAt evaluates)
    H.curves = { T0x: P.T0, dtx: P.dt, x: H.side > 0 ? u : u.map((v) => MIR - v), u, live: !P.empty };
    H.moves = P.empty ? [] : movesOf(u, P.T0, P.dt, P.live, H.side);
    pathIters = Math.max(pathIters, sol[h].iters); pathUnsettled += sol[h].unsettled;
  });
  const pathMs = now() - tPath;
  // where the hand is across the keys at time t (uAt: in its own coordinate)
  const uAt = (h, t) => { const C = plan[h].curves; return bspline(C.u, C.T0x, C.dtx, t); };
  const xAt = (h, t) => (plan[h].side > 0 ? uAt(h, t) : MIR - uAt(h, t));
  // ---- releases from the path (FINAL-SPEC S4.4): a press lets go at its note's end, but by the first moment after its
  // strike (onKey + strikePost) that the path carries its key more than PATH.leave further out of the press's own window
  // than it was then (leave: it does not ride up with its key: riding on, it would be dragged sideways off it), by its
  // finger's next contact (offNextTc), by the fingering's next hand place, which cannot reach it (that event's contact
  // less strikePre: then the hand is there; leave), and 0.03 s before the key is struck again; never before its floor
  // (0.05 s after its onset, less when this finger plays again sooner; a late strike holds its key 0.02 s at least).
  plan.forEach((H, h) => H.presses.forEach((pr) => pr.forEach((p) => {
    let off = Math.min(p.on + p.note.dur, p.offNextTc, p.offKey ?? Infinity, p.rollOff ?? Infinity), leave = p.rollOff != null && p.rollOff <= off;
    if (p.cutEv && p.cutEv.tc - PATH.strikePre < off) { off = p.cutEv.tc - PATH.strikePre; leave = true; }
    // (lunging: widened as its event's, toward the hand's last place)
    const [lo, hi] = winU(p), e = H.events[p.ev], ext = H.side > 0 ? [e.plo - e.wlo, e.whi - e.phi] : [e.whi - e.phi, e.plo - e.wlo];
    const wlo = lo - ext[0], whi = hi + ext[1], out = (t) => { const u = uAt(h, t); return Math.max(0, wlo - u, u - whi); };
    const t0 = p.onKey + (e.hurry ? 0 : PATH.strikePost), v0 = out(t0);
    for (let t = t0 + 0.01; t < off; t += 0.01) if (out(t) > v0 + PATH.leave) { off = t; leave = true; break; }
    p.off = Math.max(p.floor, off);
    p.leave = leave && p.off === off;
    delete p.offKey; delete p.offNextTc; delete p.cutEv;
  })));
  const byPitch = new Map();
  for (const p of all) { if (!byPitch.has(p.pitch)) byPitch.set(p.pitch, []); byPitch.get(p.pitch).push(p); }
  for (const L of byPitch.values()) L.sort((a, b) => a.on - b.on || a.hand - b.hand || a.f - b.f);
  // After the release the fingertip rides up with the key for `ride` s, less when this finger or another strikes again
  // soon, and not at all when it lets go because the hand moves on (leave).
  // (each key's contacts in order: the first after a release, by binary search)
  const tcOf = new Map(); for (const [pitch, L] of byPitch) tcOf.set(pitch, Float64Array.from(L, (q) => q.tc).sort());
  plan.forEach((H, h) => H.presses.forEach((pr) => pr.forEach((p, i) => {
    // (less, and none at all, as the hand moves up to rideMove across the keys meanwhile: riding on, the finger would be
    // dragged sideways)
    let r = p.leave || (!p.f && !CFG.rideThumb) ? 0 : CFG.rideMax * clamp(1 - Math.abs(xAt(h, p.off + CFG.rideMax) - xAt(h, p.off)) / CFG.rideMove, 0, 1);
    if (i + 1 < pr.length) r = Math.min(r, CFG.rideShare * (pr[i + 1].tc - p.off));
    const T = tcOf.get(p.pitch); let lo = 0, hi = T.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (T[m] > p.off) hi = m; else lo = m + 1; }
    if (lo < T.length) r = Math.min(r, CFG.rideShare * (T[lo] - p.off));
    p.ride = Math.max(0, r);
    delete p.leave;
  })));

  // ---- the crossing posture and close hands (FINAL-SPEC S5.3, S5.4; a smooth offset of the hand's height and depth
  // until S6 makes them part of its y and z channels). In a crossing the crossing hand plays crossLift higher and crossIn
  // further in, its wrist raised (crossPitch) and its forearm lifted with it (crossElbow), eased in and out about the
  // padded ends, so its palm and forearm pass over the back of the other hand; the other hand keeps its place, closeOut
  // nearer the pianist. While it passes over the other hand (knuckles less than crossArc[1] apart across the keys) with no
  // key to play (a free stretch: its presses from just before contact to release and ride, joined across gaps shorter than
  // crossFree where it stays within crossStay across the keys, so a figure played in place does not pump up and down), it
  // goes crossArc[0] higher still, an arc over the other hand, and its free fingers are drawn in to their places in the
  // hand (poseHand): reaching ahead for their next keys, the thumb hung 2.9 below the knuckles and went through the other
  // hand's knuckles (Interstellar 159.7 s, Wedding Day 157.8 s, the Pathetique's right hand at 121.1 s). Elsewhere, close hands (knuckles less than closeGap apart; gaps under 0.3 s bridged) play one in front of the
  // other: the right hand closeIn further in, the left closeOut nearer the pianist. (After the releases: the free
  // stretches need the final ones.)
  plan.crossings = crossings.map((c) => ({ t0: c.t0, t1: c.t1, hand: c.hand, minGap: c.minGap }));
  const crossSteps = [[], []], crossAll = [], closeSteps = [[], []], arcSteps = [[], []];
  for (const c of crossings) { crossSteps[c.hand].push([c.t0, c.t1, 1]); crossAll.push([c.t0, c.t1, 1]); }
  if (both) {
    // (thumbNearL: the right thumb on a key, or within thumbNear s of it, while the left hand has one down within
    // closeThumbR of it, across the keys)
    const thumbNearL = new Uint8Array(gN), Lp = plan[1].presses.flat();
    for (const p of plan[0].presses[0]) for (const q of Lp) {
      const a = Math.max(p.tc, q.tc) - PATH.thumbNear, b = Math.min(p.off + p.ride, q.off + q.ride) + PATH.thumbNear;
      if (b > a && KX[q.pitch] > KX[p.pitch] - PATH.closeThumbR) for (let i = gi(a); i <= gi(b); i++) thumbNearL[i] = 1;
    }
    for (const h of [0, 1]) {
      let run = null;
      for (let i = 0; i < gN; i++) {
        const t = gT0 + i * dtg, cl = xAt(0, t) - xAt(1, t) < PATH.closeGap && (h === 1 || thumbUse[1][i] >= PATH.closeThumbL || thumbNearL[i]);
        if (cl) { if (run && t - run[1] < 0.3) run[1] = t; else { run = [t, t, 1]; closeSteps[h].push(run); } }
      }
    }
    for (const c of crossings) { const hc = c.hand;
      const busy = [];
      for (const [a, b] of plan[hc].presses.flat().filter((p) => p.off + p.ride > c.t0 - 1 && p.tc < c.t1 + 1).map((p) => [p.tc - 0.05, p.off + p.ride]).sort((x, y) => x[0] - y[0])) {
        const l = busy[busy.length - 1];
        if (l && a - l[1] < PATH.crossFree && Math.abs(xAt(hc, a) - xAt(hc, l[1])) < PATH.crossStay) l[1] = Math.max(l[1], b); else busy.push([a, b]);
      }
      let run = null;
      for (let i = c.i0; i <= c.i1; i++) {
        const t = gT0 + i * dtg;
        if (Math.abs(xAt(0, t) - xAt(1, t)) >= PATH.crossArc[1] || busy.some(([a, b]) => t >= a && t <= b)) continue;
        const a = t - PATH.crossArc[2], b = t + PATH.crossArc[2];
        if (run && a <= run[1]) run[1] = b; else { run = [a, b, 1]; arcSteps[hc].push(run); }
      }
    }
  }
  // (apartOff[m]: the remedies that keep the hands from touching, B-splines worked out at the end of the plan (null: none):
  // 0 the right hand lifted, 1 the left hand lifted, 2 the right hand in and the left out, 3 the left hand in and the right
  // out; apartTry: a remedy being tried there)
  const apartOff = [null, null, null, null], apartTry = [0, 0, 0, 0];
  const apartAt = (m, t) => (apartOff[m] ? bspline(apartOff[m].c, apartOff[m].T0, apartOff[m].dt, t) : 0) + apartTry[m];
  // [lift, depth, elbow lift, pitch, close, arc (0..1: the free fingers drawn in)]
  const offsetAt = (h, t) => {
    const ap = apartAt(h, t), az = (apartAt(2, t) - apartAt(3, t)) * (h ? PATH.apartZ[1] : -PATH.apartZ[0]);
    const X = crossAll.length ? stepsAt(crossAll, t, PATH.crossSig) : 0, Xh = crossSteps[h].length ? stepsAt(crossSteps[h], t, PATH.crossSig) : 0;
    const C = closeSteps[h].length ? stepsAt(closeSteps[h], t, PATH.closeSig) : 0;
    const arc = arcSteps[h].length ? stepsAt(arcSteps[h], t, PATH.crossSig) : 0;
    // (a hand lifted to keep from touching the other draws its free fingers in as well, by apartTuck of lift)
    return [PATH.crossLift * Xh + PATH.crossArc[0] * arc + ap, (1 - X) * C * (h ? PATH.closeOut : PATH.closeIn) + Xh * PATH.crossIn + (X - Xh) * PATH.closeOut + az, PATH.crossElbow * Xh, PATH.crossPitch * Xh, (1 - X) * C, Math.max(arc, Math.min(1, ap / PATH.apartTuck))];
  };

  const LSUM = SEG.map((q) => q[0] + q[1] + q[2]);
  // (curl round) a curl limit's number for posture Q (lyrical to classical by its classical weight w; legacy: classical), and
  // the knuckle-to-tip distance at which finger f bends by th deg
  const curlOf = (A, Q) => A[0] + (Q.w ?? 1) * (A[1] - A[0]);
  const curlD = (f, th, dip) => chainReach(SEG[f], th * DEG, dip);
  // (the hand at rest, and how far forward it may come while finger f holds a white key struck at slotZ: the first pass of
  // the forward-shift limits, below)
  const ZERO = handFrame(V(0, CFG.Y0, CFG.Z0), 0, CFG.PITCH0, CFG.ROLL0, 1, true);
  const cap0 = [0, 1, 2, 3, 4].map((f) => (f ? ZERO.W(MCP_L[f]).z - CFG.slotZ - CFG.hWhite[f] : null));
  // (posture presets: from the press's own posture, its finger struck at its natural depth or the least the key allows)
  const kz0 = (Q, f) => handFrame(V(0, Q.Y0, Q.Z0), 0, Q.pitch, CFG.ROLL0, 1, true).W(MCP_L[f]).z;
  const cap0At = (f, p) => { if (LEG) return cap0[f]; const Q = pqOf(p); return kz0(Q, f) - Math.max(Q.zTip[f], slotMin(p.pitch, Q)) - Q.hWhite[f]; };
  // (S4 fix) ... and while the hand comes forward for a black key: on C, E, F or B into the key's narrow part, on D, G or
  // A curled to hDGA (capB: the black keys' layer of the forward shift, below)
  const hOf = (f, p) => (isBlack(p) ? CFG.hHook : WIDE(p) ? CFG.hWhite : CFG.hDGA)[f];
  const cap0B = (f, p) => ZERO.W(MCP_L[f]).z - slotMin(p) - hOf(f, p);
  const cap0BAt = (f, p) => { if (LEG) return cap0B(f, p.pitch); const Q = pqOf(p); return kz0(Q, f) - slotMin(p.pitch, Q) - hOfQ(f, p.pitch, Q); };
  // where the pianist sits: between the hands' usual places
  const mean = (ev, d) => (ev.length ? ev.reduce((s, e) => s + e.anchor, 0) / ev.length : d);
  const bodyX = (mean(plan[0].events, fallbackX[0]) + mean(plan[1].events, fallbackX[1])) / 2;

  plan.forEach((H, h) => {
    // How far the hand turns toward its little finger for a thumb's key out of the thumb's reach: thumbTurn[0] per unit
    // out, at most thumbTurn[1] (or thumbTurn[2] past undoing the elbow's turn toward the thumb). Turned about the fingertips, the hand carries the thumb's base (3.1 behind the knuckles)
    // outward, about 1.35 for 16 deg, while the fingertips stay where they are. How far out: at the contact, half-way and
    // at the release (it holds its key until then), from the rig's own geometry: from the thumb's base, in the hand turned
    // toward the elbow only (frameAt's y0) and as far forward as the press lets the hand come (zfOf: ZNEED_WHITE, but no
    // further than a finger 2-5 holding a white key meanwhile allows, cap0), to its tip joint's target at the front of its
    // key's zone, beyond the thumb's natural reach (RHO of its length), across the keys.
    // (S3 fix: by the reach band BANDS.N, with the base's swing as sin(y0) times its depth, this saw 0.16 out where the
    // thumb fell 0.75 short: Bach's left thumb on E4 while the middle finger holds C4, the hand turned 16 deg toward its
    // thumb by the elbow and held back for the middle finger, 0.15 forward instead of 0.4. Measured from the geometry, the
    // turn reached 16 deg and the thumb was 0.25 short; with the cap past the elbow's turn, 20 deg, it is on its key.)
    const y0At = (t) => 0.55 * Math.atan2(bodyX + H.side * 7.0 - xAt(h, t), 14.5);
    const side = H.side, o = CFG.thumbContact, R0 = CFG.RHO[0] * LSUM[0];
    const zfOf = (p) => {
      if (isBlack(p.pitch)) return needB(h, 0, p.tc);
      let z = needW(h, 0, p.tc);
      for (let f = 1; f < 5; f++) {
        const pr = H.presses[f]; let lo = 0, hi = pr.length;
        while (lo < hi) { const m = (lo + hi) >> 1; if (pr[m].on < p.off) lo = m + 1; else hi = m; }
        for (let j = lo - 1, n = 0; j >= 0 && n < 8; j--, n++) if (pr[j].off > p.tc && !isBlack(pr[j].pitch)) z = Math.min(z, cap0At(f, pr[j]));
      }
      return z;
    };
    const out = (p) => {
      const blk = isBlack(p.pitch), zf = zfOf(p), zone = blk ? CFG.zoneBlack[0] : CFG.thumbZone;
      const tx = KX[p.pitch] + (blk ? 0 : side * CFG.thumbXs) - side * o[0], ty = keySurfaceY(p.pitch, zone[1], 1) + o[1] - CFG.squash, tz = zone[1] - o[2];
      let w = -Infinity;
      for (const t of [p.tc, (p.tc + p.off) / 2, p.off]) {
        const [oy, oz, , op] = offsetAt(h, t), q = PQ(h, t, true), k = handFrame(V(xAt(h, t), q.Y0 + CFG.yPerZ * zf + oy, q.Z0 - zf + oz), y0At(t), q.pitch + op, CFG.ROLL0, side, true).W(CMC_L);
        const ryz = Math.hypot(k.y - ty, k.z - tz);
        w = Math.max(w, side * (k.x - tx) - Math.sqrt(Math.max(0, R0 * R0 - ryz * ryz)));
      }
      return w;
    };
    // (no more than keeps this hand's thumb side clear of the other hand (turnApart), the two hands' knuckles d apart at the
    // contact and the release)
    const apart = (p) => Math.min(...[p.tc, p.off].map((t) => Math.asin(clamp((side * (xAt(h, t) - xAt(1 - h, t)) - CFG.turnApart[0]) / CFG.turnApart[1], 0, 1))));
    const capOf = (p) => Math.max(CFG.thumbTurn[1], side * y0At(p.tc) + CFG.thumbTurn[2]);
    H.yawSeg = forwardSteps(H.presses, (p, f) => (f === 0 ? Math.min(CFG.thumbTurn[0] * Math.max(0, out(p)), capOf(p), apart(p)) : 0));
    // The spread posture (class S: octaves, chords and figures an octave wide): the little finger fanned out spanFan (and
    // the hand turned spanYaw toward it, about its knuckles), as FINAL-SPEC S3.2's class S reach band assumes; until S6's
    // channels, as steps smoothed like the forward shift
    H.spanSeg = forwardSteps(H.presses, (p) => (p.post === 'S' ? 1 : 0));
  });

  // the hand's frame at time t: its anchor across the keys and how far forward it is, in the playing posture (pitched
  // wrist-down and rolled a little toward the little finger), turned a little toward the elbow, which comes from where the
  // pianist sits, and toward its little finger for a thumb out of reach (about the fingertips: the knuckle moves toward
  // the thumb by turnPivot times the turn's sine). (The hands keep out of each other's way in their paths, S5, and in a
  // crossing or close together by offsetAt's height and depth.)
  // (while the strike points are worked out, the parts of the frame that do not depend on the forward shift are kept by
  // time in `across`: each pass asks for the same moments again)
  let across = null;
  function frameAt(h, t, light = false) {
    const H = plan[h], side = H.side;
    let a = across ? across[h].get(t) : undefined;
    if (a === undefined) {
      const ax = xAt(h, t);
      const y0 = Math.atan2(bodyX + side * 7.0 - ax, 14.5) * 0.55, yawT = y0 - side * stepsAt(H.yawSeg, t, CFG.sigZ);
      a = [ax + CFG.turnPivot * (Math.sin(yawT) - Math.sin(y0)), yawT, H.spanSeg ? stepsAt(H.spanSeg, t, CFG.sigZ) : 0, ...offsetAt(h, t), PQ(h, t, true)];
      if (across) across[h].set(t, a);
    }
    // (S5: the crossing posture and close hands' offsets, a[3] up and a[4] along z; the forearm keeps the hand's height)
    // (the posture, a[9]: the knuckles' height and depth and the pitch)
    const q = a[9], zf = stepsAt(H.zSeg, t, CFG.sigZ), O = V(a[0], q.Y0 + CFG.yPerZ * zf + a[3], q.Z0 - zf + a[4]);
    // (fingers round 2: the hand leaning toward a key out of its finger's reach at the strike, below)
    if (H.leanX) { O.x += stepsAt(H.leanX, t, CFG.leanSig); O.z += stepsAt(H.leanZ, t, CFG.leanSig); }
    const elbow = V(bodyX + side * 7.0, q.Y0 - 3.2 + a[3] + a[5], O.z + 14.5);
    const F = handFrame(O, a[1] - side * CFG.spanYaw * a[2], q.pitch + a[6], CFG.ROLL0, side, light);
    F.fan = CFG.spanFan * a[2]; F.yOff = a[3]; F.zOff = a[4]; F.close = a[7]; F.tuck = a[8]; F.Z0 = q.Z0;
    return { F, elbow };
  }

  // How far forward the hand comes (forwardSteps), and each press's strike point, in passes. The forward shift is
  // ZNEED_BLACK for a finger on a black key. While a finger 2-5 holds a key, the shift is held back to where that finger is
  // still hNeed (hHook on a black key, hWhite on a white one) in front of its knuckle: p.cap, from the press's strike point
  // in the pass before (in the first pass, white keys only, struck at slotZ). The strike point comes from the hand's frame
  // when the key reaches the bottom (onKey: until S4 the old track brings the hand to each note at its onset, d after the
  // contact; taken at tc, the strike suits a hand still on its way, and more skin goes into the keys beside it); for
  // fingers 2-5 also from where their knuckle is over the whole time the fingertip is on the key (tc to off + ride), so
  // that they neither hook under nor fall short of the key meanwhile.
  // (pad: the pad's place along the key, only needed in the last pass; the passes before it give the forward-shift limits,
  // which come from the tip joint's place)
  const strikeOf = (h, f, p, pad) => {
    const F = frameAt(h, p.onKey, true).F, t1 = p.off + p.ride;
    const n = Math.max(2, Math.ceil((t1 - p.tc) / 0.03)), hold = [];
    for (let i = 0; i <= n; i++) { const G = frameAt(h, p.tc + ((t1 - p.tc) * i) / n, true).F; hold.push({ k: G.W(baseL(G, f)), az: G.ax.z, G }); }
    const Q = pqOf(p);
    if (!f) { Object.assign(p, strikePoint(f, p.pitch, F, hold, true, false, Q)); return; }
    const sp = strikePoint(f, p.pitch, F, hold, pad, !!p.noSlot, Q);
    if (sp.slotRefused) p.noSlot = true;
    delete sp.slotRefused; Object.assign(p, sp);
    p.cap = F.W(baseL(F, f)).z + (F.Z0 + F.zOff - F.O.z) - p.zt - (isBlack(p.pitch) ? Q.hHook : Q.hWhite)[f];
    // (posture presets: a finger kept in front of the black keys (refused between them) does not hold the hand back from
    // coming forward over the black keys; it lets go of its key in time instead (depthRelease, by capR: as far as it can
    // curl, its tip joint hHook in front of its knuckle), so it is not left hooked under the hand)
    p.capB = p.noSlot && !Q.legacy ? null : p.cap + (isBlack(p.pitch) ? 0 : Q.hWhite[f] - hOfQ(f, p.pitch, Q));
    p.capR = p.capB == null ? p.cap + Q.hWhite[f] - Q.hHook[f] : p.capB;
  };
  // (S3) A finger 2-5 holding a white key lets go in time for the hand to come forward for a later key of the same hand
  // that needs it further forward than this hold allows (its cap): depthLead s before that key's contact (the forward
  // shift is held back until capTail after a release, then rises over about 1.3 sigZ). It does not ride up with its key.
  // (The depth twin of the release when the hand moves on across the keys, above. The fingering now plays every note of
  // the Revolutionary's chords, as an octave on black keys right after a white one, where the hand then came forward
  // only after the black keys' contact: the fingertips met them 0.13 above their tops.)
  const depthRelease = () => plan.forEach((H) => {
    const L = []; H.presses.forEach((pr, f) => pr.forEach((p) => L.push(p)));
    L.sort((a, b) => a.tc - b.tc);
    L.forEach((p, i) => {
      const cb = p.capR ?? p.capB;
      if (!p.f || isBlack(p.pitch) || cb == null) return;
      for (let j = i + 1; j < L.length && L[j].tc - CFG.depthLead < p.off; j++) {
        const q = L[j];
        if (q.f === p.f || q.on <= p.on || !isBlack(q.pitch) || needB(q.hand, q.f, q.tc) <= cb + 0.1) continue;
        const o = Math.max(p.on + 0.05, q.tc - CFG.depthLead);
        if (o < p.off) { p.off = o; p.ride = 0; }
        break;
      }
    });
  });
  across = [new Map(), new Map()];
  // (S4 fix: and more passes, at most zPassesMax, while the last one refused a finger the narrow part of its key: the
  // forward shift it was struck under came from the pass before, which had it there)
  const refused = () => plan.reduce((n, H) => n + H.presses.reduce((m, pr) => m + pr.filter((p) => p.noSlot).length, 0), 0);
  for (let pass = 0, nr = 0; pass < CFG.zPassesMax; pass++) {
    // (two layers: the white keys' needs (the thumb's ZNEED_WHITE) held back by the usual caps, and the black keys' needs
    // held back by capB, with fingers 2-5 on white keys in the narrow part of C, E, F and B or curled on D, G and A)
    plan.forEach((H, h) => { H.zSeg = forwardSteps(H.presses, (p, f) => (isBlack(p.pitch) ? 0 : needW(h, f, p.tc)), (p, f) => (!f ? null : pass ? p.cap : isBlack(p.pitch) ? null : cap0At(f, p)),
      [(p, f) => (isBlack(p.pitch) ? needB(h, f, p.tc) : 0), (p, f) => (!f ? null : pass ? p.capB : isBlack(p.pitch) ? null : cap0BAt(f, p))]); });
    plan.forEach((H, h) => H.presses.forEach((pr, f) => { for (const p of pr) strikeOf(h, f, p, pass >= CFG.zPasses - 1); }));
    if (pass === 0 && CFG.depthLead > 0) depthRelease();
    const fc = pass === 0 && frontFromRefused();
    const n = refused(); if (pass >= CFG.zPasses - 1 && n === nr && !fc) break; nr = n;
  }
  // (S3) A finger 2-5 also lets go as soon as the hand, moving on, would turn it more than dragSide sideways at its
  // knuckle, from dragAfter s after its key reaches the bottom, even before the 0.05 s a press otherwise lasts (the old
  // planner's track sets off for the next notes about 0.25 s before them, and in fast passages the new fingering's hand
  // places jump further: a finger left holding a short note was dragged sideways up to 80 deg, past 90 deg at the knuckle,
  // its side in the next key; Revolutionary 5.93 s R5 on G5, 13.98 s L3 on D3; Alla Turca 96.2 s L2 on E3). It does not
  // ride up with its key. (Checked where the hand moves more than 0.3 during the hold.)
  plan.forEach((H, h) => H.presses.forEach((pr, f) => {
    if (!f) return;
    for (const p of pr) {
      const t0 = p.onKey + CFG.dragAfter, t1 = p.off + p.ride;
      // (S4 fix: by the hand's frame, not the path alone: the thumb's turn swings the knuckles too; Op. 25's left index on G3
      // at 63.12 s was turned 74 deg sideways, past 90 deg at the knuckle, while the path moved 0.25)
      if (t1 <= t0) continue;
      const side = (t) => { const F = frameAt(h, t, true).F, l = F.local(V(p.xs, keyTop(p.pitch), p.zs)), K = baseL(F, f); return Math.atan2(Math.abs(l[0] - K[0]), K[2] - l[2]); };
      if (side(t0) <= CFG.dragSide) { const A = frameAt(h, t0, true).F, B = frameAt(h, t1, true).F; if (Math.abs(B.O.x - A.O.x) < 0.3 && Math.abs(B.yaw - A.yaw) < 3 * DEG && Math.abs(B.O.z - A.O.z) < 0.3) continue; }
      for (let t = t0; t < t1; t += 0.01) if (side(t) > CFG.dragSide) { p.off = Math.min(p.off, Math.max(t0, t)); p.ride = 0; break; }
    }
  }));
  // (S4) And every finger lets go once the hand, moving on (across the keys, forward or turning), carries its key more than
  // PATH.leave further out of its reach than it was just after the strike (onKey + strikePost): from its base joint (the
  // knuckle, the thumb's base) to the tip joint's place over its contact point, beyond the finger's length. It does not
  // ride up with its key. (The release from the path above uses the fingering's reach bands, and in the spread posture S
  // the thumb's band, 1.4 beyond its rest place, assumes the hand turned 10 deg toward its little finger, which waits for
  // S6: Bach's right thumb held its G3 at 62.1 s until the hand was 1.7 out of reach, and stretched out after the hand.)
  // (how far finger f of hand h is beyond its length from press p's contact at t)
  const shortOf = (h, f, p) => {
    const o = CFG.thumbContact, below = f ? padLookup(f, pqOf(p).beta[f]).below - CFG.squash : 0, c = V(p.xs, keySurfaceY(p.pitch, p.zs, 1), p.zs);
    return (t) => {
      const F = frameAt(h, t, true).F;
      const tip = f ? c.clone().setY(c.y + below) : c.clone().sub(F.rot([o[0], 0, 0])).add(V(0, o[1] - CFG.squash, -o[2]));
      return (f ? knuckle(F, f, tip) : F.W(CMC_L)).distanceTo(tip) - LSUM[f];
    };
  };
  // (fingers round 1) A strike its finger cannot reach at its contact or as its key reaches the bottom (the hand not as far
  // forward there as the strike planned for it) moves out along its key toward the key's front, as far as it needs to (to
  // strikeFwd beyond the finger's length at most), within the finger's zone: as a pianist's little finger plays a white key
  // nearer its front than the middle finger does. (Moonlight 1's right little finger on C5 at 108.85 s, struck between the
  // black keys, fell 1.5 short of its key; its right thumb on G-sharp3 at 35.52 s, 1.9.)
  plan.forEach((H, h) => H.presses.forEach((pr, f) => {
    for (const p of pr) {
      const blk = isBlack(p.pitch), zMax = blk ? (f ? CFG.padBlack : CFG.zoneBlack[0][1]) : f ? CFG.padZone[1] : CFG.thumbZone[1];
      // (not where the hands are close: there the two thumbs pass one behind the other, S5, by their depths along the keys)
      if (p.zs >= zMax - 0.01 || (!f && !blk) || frameAt(h, p.tc, true).F.close > 0) continue;
      const sh = (q) => { const S = shortOf(h, f, q); return Math.max(S(p.tc), S(p.onKey)); }, s0 = sh(p);
      if (s0 <= CFG.strikeFwd) continue;
      const at = (z) => {
        const q = Object.create(p); q.zs = z;
        if (!blk && f && p.zs < BLACK_FRONT && z >= BLACK_FRONT) { const sl = slackOf(f, p.pitch); q.xs = KX[p.pitch] + clamp(p.xs - KX[p.pitch], -sl, sl); }
        return q;
      };
      if (sh(at(zMax)) >= s0 - 0.02) continue;
      let lo = p.zs, hi = zMax;
      for (let it = 0; it < 6; it++) { const mz = (lo + hi) / 2; if (sh(at(mz)) > CFG.strikeFwd) lo = mz; else hi = mz; }
      // (a white key's finger that comes out to the black keys' fronts comes out to strikeFront in front of slotZ: its last
      // bone, reaching back, would lie under the corners of the black keys beside it)
      if (!blk && hi > BLACK_FRONT - 0.3) hi = Math.min(zMax, Math.max(hi, CFG.slotZ + CFG.strikeFront));
      const q = at(hi), dz = hi - p.zs;
      p.zs = hi; p.xs = q.xs; p.zt += dz; p.fwd = true; leaps.forward[h]++;
    }
  }));
  // (fingers round 2) The hand leans toward a key its finger cannot reach at the strike: as a pianist's hand, arriving at
  // a bass octave or a thumb's black key, goes the last bit toward the key with the finger, instead of the finger
  // stretching straight out for it. For each press whose finger is more than leanMin beyond leanRho of its length from its
  // contact at its contact or as its key reaches the bottom, the hand's shift (across the keys and along them) that brings
  // it, and the fingers of its own chord, within that reach (least squares; the fingers still holding older keys count
  // leanOld as much: they let go instead, below, the pedal holding the sound), at most leanMax; held from leanLead before
  // the contact until leanHold after the key reaches the bottom (or its release), as steps smoothed by a Gaussian of
  // leanSig s (frameAt). (The path's jerk term keeps the hand short of a tight leap's window: Cornfield Chase's left hand
  // reached its octave G1-G2 at 101.47 s 0.7 short of its window, and the little finger struck G1 straight, sideways.)
  {
    const tipOf = (f, p, F) => {
      const c = V(p.xs, keySurfaceY(p.pitch, p.zs, 1), p.zs), o = CFG.thumbContact;
      if (f) return c.setY(c.y + padLookup(f, pqOf(p).beta[f]).below - CFG.squash);
      return c.sub(F.rot([o[0], 0, 0])).add(V(0, o[1] - CFG.squash, -o[2]));
    };
    plan.forEach((H, h) => {
      const L = []; H.presses.forEach((pr, f) => pr.forEach((p) => L.push([f, p])));
      L.sort((a, b) => a[1].tc - b[1].tc);
      const req = [];
      const solve = (t, i0) => {
        const F = frameAt(h, t, true).F, items = [];
        for (let j = i0; j >= 0 && L[j][1].tc > t - 4; j--) {
          const [f, q] = L[j];
          // (a key let go of within leanLead before t: an anchor only, the lean being on its way then)
          if (q.tc - CFG.leanChord > t || t - CFG.leanLead > q.off) continue;
          const tip = tipOf(f, q, F), base = f ? knuckle(F, f, tip) : F.W(CMC_L);
          items.push({ tip, base, R: CFG.leanRho * LSUM[f], w: t > q.off ? 0 : Math.abs(q.tc - L[i0][1].tc) <= CFG.leanChord ? 1 : CFG.leanOld, slot: f && !isBlack(q.pitch) && q.zs < BLACK_FRONT + 0.1, white: !isBlack(q.pitch) });
        }
        for (let j = i0 + 1; j < L.length && L[j][1].tc - CFG.leanChord <= t; j++) {
          const [f, q] = L[j]; const tip = tipOf(f, q, F);
          items.push({ tip, base: f ? knuckle(F, f, tip) : F.W(CMC_L), R: CFG.leanRho * LSUM[f], w: 1, slot: f && !isBlack(q.pitch) && q.zs < BLACK_FRONT + 0.1, white: !isBlack(q.pitch) });
        }
        // (a finger 2-5 on a white key between the black keys holds the hand from moving across the keys: turned sideways
        // there, its last bone goes into the black key beside it)
        // (and any finger on a white key from moving along the keys: the forward shift is held back for it, its cap; brought
        // forward past it, a finger 2-5 hooks under the hand and its last bone into the black keys' fronts, and the thumb's
        // side goes down into the key beside it)
        // (the fingers still holding older keys: those of the chord itself reach their keys together, above)
        // (a key already let go of, leanGone as much)
        const an = (q) => (q.w === 0 ? CFG.leanGone : q.w < 1 ? 1 : 0);
        const ws = CFG.leanMu + CFG.leanSlot * items.reduce((a, q) => a + (q.slot ? an(q) : 0), 0);
        const wz = CFG.leanMu + CFG.leanSlot * items.reduce((a, q) => a + (q.white ? an(q) : 0), 0);
        let dx = 0, dz = 0;
        for (let it = 0; it < 6; it++) {
          let a11 = ws, a12 = 0, a22 = wz, g1 = ws * dx, g2 = wz * dz;
          for (const q of items) {
            const vx = q.base.x + dx - q.tip.x, vy = q.base.y - q.tip.y, vz = q.base.z + dz - q.tip.z, d = Math.hypot(vx, vy, vz) || 1, r = d - q.R;
            if (r <= 0) continue;
            const jx = vx / d, jz = vz / d;
            a11 += q.w * jx * jx; a12 += q.w * jx * jz; a22 += q.w * jz * jz; g1 += q.w * jx * r; g2 += q.w * jz * r;
          }
          const det = a11 * a22 - a12 * a12; if (!(det > 1e-12)) break;
          const sx = -(a22 * g1 - a12 * g2) / det, sz = -(a11 * g2 - a12 * g1) / det;
          dx += sx; dz += sz;
          if (Math.hypot(sx, sz) < 1e-3) break;
        }
        const m = Math.hypot(dx, dz); if (m > CFG.leanMax) { dx *= CFG.leanMax / m; dz *= CFG.leanMax / m; }
        // (not toward the other hand where the two are close, and only leanCloseZ as much along the keys: they would touch, S5)
        const ka = smoothstep(PATH.closeGap, PATH.closeGap + CFG.leanApart, H.side * (xAt(h, t) - xAt(1 - h, t)));
        if (H.side * dx < 0) dx *= ka;
        dz *= CFG.leanCloseZ + (1 - CFG.leanCloseZ) * ka;
        return [dx, dz];
      };
      L.forEach(([f, p], i) => {
        const S = shortOf(h, f, p), own = Math.max(S(p.tc), S(p.onKey)) + (1 - CFG.leanRho) * LSUM[f];
        if (own <= CFG.leanMin) return;
        const A = solve(p.tc, i), B = solve(p.onKey, i), D = Math.hypot(...A) > Math.hypot(...B) ? A : B;
        if (Math.hypot(...D) < CFG.leanMin) return;
        req.push([p.tc - CFG.leanLead, Math.max(p.onKey, Math.min(p.off, p.onKey + CFG.leanHold)), D[0], D[1]]);
      });
      if (!req.length) return;
      // (on a grid of 5 ms: where requests overlap, the larger; then runs of one value as steps)
      const DT = 0.005, t0 = Math.min(...req.map((r) => r[0])) - 0.1, n = Math.ceil((Math.max(...req.map((r) => r[1])) + 0.1 - t0) / DT) + 1;
      const gx = new Float32Array(n), gz = new Float32Array(n), gm = new Float32Array(n);
      for (const [a, b, x, z] of req) { const m = Math.hypot(x, z); for (let k = Math.max(0, Math.round((a - t0) / DT)), e = Math.min(n - 1, Math.round((b - t0) / DT)); k <= e; k++) if (m > gm[k]) { gm[k] = m; gx[k] = x; gz[k] = z; } }
      H.leanX = []; H.leanZ = [];
      for (let k = 0; k < n;) { let j = k; while (j + 1 < n && gx[j + 1] === gx[k] && gz[j + 1] === gz[k]) j++; if (gm[k] > 0) { const a = t0 + (k - 0.5) * DT, b = t0 + (j + 0.5) * DT; H.leanX.push([a, b, gx[k]]); H.leanZ.push([a, b, gz[k]]); } k = j + 1; }
      leaps.leaned[h] = req.length;
      // (a finger 2-5 on a white key struck or held while the hand leans: its strike point again, from the leaning hand: the
      // depth it goes into the narrow part between the black keys was worked out for the hand as it was; not one moved out
      // along its key to be reached, above)
      const la = (t) => Math.abs(stepsAt(H.leanX, t, CFG.leanSig)) + Math.abs(stepsAt(H.leanZ, t, CFG.leanSig));
      for (const [f, p] of L) if (f && !isBlack(p.pitch) && !p.fwd && p.zs < CFG.slotZ + CFG.slotHold && Math.max(la(p.tc), la(p.onKey), la(Math.min(p.off, p.onKey + 0.3))) > CFG.leanRestrike) strikeOf(h, f, p, true);
    });
  }
  // (curl round) And a strike its finger 2-5 would reach only bent more than curlStrike, at its contact or as its key
  // reaches the bottom (the hand come forward over it, or leaning: after the lean, above), moves in along its key, away from the knuckle, until it does not:
  // on a black key as far as the finger's zone (zoneBlack), on a white key not past slotZ + strikeFront (the black keys'
  // fronts). (Revolutionary 5.58 s, lyrical: the right middle finger struck E-flat5 2.1 in front of its knuckle, PIP 95.)
  plan.forEach((H, h) => H.presses.forEach((pr, f) => {
    if (!f) return;
    for (const p of pr) {
      const blk = isBlack(p.pitch), zMin = blk ? CFG.zoneBlack[f][0] : CFG.slotZ + CFG.strikeFront;
      if (p.zs <= zMin + 0.01) continue;
      const Q = pqOf(p), need = curlD(f, curlOf(CFG.curlStrike, Q), Q.dip) - LSUM[f];
      const sh = (q) => { const S = shortOf(h, f, q); return Math.min(S(p.tc), S(p.onKey)); };
      if (sh(p) >= need) continue;
      const at = (z) => { const q = Object.create(p); q.zs = z; return q; };
      // (the deepest it may go if even that is not enough, where that helps; else the shallowest depth that is enough)
      let lo = zMin, hi = p.zs;
      if (sh(at(zMin)) < need) { if (sh(at(zMin)) <= sh(p) + 0.02) continue; }
      else for (let it = 0; it < 6; it++) { const mz = (lo + hi) / 2; if (sh(at(mz)) >= need) lo = mz; else hi = mz; }
      const dz = lo - p.zs;
      if (dz > -0.005) continue;
      // (and not where its finger would then be out of reach later in its hold, as the hand moves on: it let go early and
      // hung straight, Clair de lune's right middle finger on A-flat3 at 37.1 s)
      const far = (q) => { const S = shortOf(h, f, q); return Math.max(...[p.onKey, (p.onKey + p.off) / 2, p.off - 0.01].filter((t) => t >= p.onKey).map(S)); };
      if (far(at(lo)) > Math.max(far(p), -(1 - CFG.leanRho) * LSUM[f])) continue;
      p.zs = lo; p.zt += dz; p.curlBack = true;
    }
  }));
  plan.forEach((H, h) => H.presses.forEach((pr, f) => {
    for (const p of pr) {
      const t0 = p.onKey + (H.events[p.ev].hurry ? 0 : PATH.strikePost), t1 = p.off;
      if (t1 <= t0 + 0.01) continue;
      const short = shortOf(h, f, p);
      // (fingers round 1) It lets go by leaveFar beyond its finger's length at most, and a hand that has moved on takes the
      // finger off its key even before its floor, as soon as the key is at the bottom (hurryHold): the pedal holds the sound,
      // and the finger is not left stretched straight after the hand. (At 130 units/s, Cornfield Chase's left hand leaving
      // A3 for the octave G1-G2 at 101.38 s had the thumb 1.6 short of its key at its floor 0.03 s later; its little finger
      // on G1 was 1.3 short at 101.53 s.) A finger already that far short just after its strike lets go at once (Clair de
      // lune's left middle finger on F4 at 37.0 s, its hand lifted over the other in a crossing, hung 1.4 above its key for
      // 3 s; Moonlight 3's right thumb on E-flat3 at 134.98 s, 2.7 short).
      const s0 = Math.max(0, short(t0)), lim = Math.min(s0 + PATH.leave, PATH.leaveFar), early = Math.min(p.floor, p.onKey + PATH.hurryHold);
      if (s0 > PATH.leaveFar) { if (early < p.off) { p.off = early; p.ride = 0; } continue; }
      for (let t = Math.min(t0, early); t < t1; t += 0.01) if (short(t) > (t < t0 ? PATH.leave : lim)) { const o2 = Math.max(early, t); if (o2 < p.off) { p.off = o2; p.ride = 0; } break; }
    }
  }));
  // (fingers round 2) A finger 2-5 on a white key also lets go once the hand, moving on, would fold it under itself (its
  // contact less than foldAhead in front of its knuckle) or turn its last bone into a black key beside it (its skin, posed
  // at the key's bottom at its usual angle, more than skinLet inside, and skinLet more than just after the strike); the
  // pedal holds the sound. (Moonlight 3's rolled chords: the right middle finger on G4 at 85.83 s, the hand come forward
  // over it for the thumb's and little finger's black keys, folded under the hand into G-sharp4, 0.4; its arpeggios: the
  // middle finger on G3 at 244.8 s, carried along, turned into G-sharp3.)
  plan.forEach((H, h) => H.presses.forEach((pr, f) => {
    if (!f) {
      // (and a thumb once the hand, come forward over it, would fold it tighter than it can: thumbFold of its length from
      // its base to its tip joint; it went down into the key beside it, Moonlight 3's right thumb on B4 at 73.05 s, 0.34)
      for (const p of pr) {
        const t0 = p.onKey + CFG.foldAfter, t1 = p.off;
        if (t1 <= t0) continue;
        const short = shortOf(h, 0, p);
        for (let t = t0; t < Math.min(t1, t0 + CFG.foldScan); t += CFG.foldStep) if (short(t) + LSUM[0] < CFG.thumbFold * LSUM[0]) { if (t < p.off) { p.off = t; p.ride = 0; } break; }
      }
      return;
    }
    for (const p of pr) {
      if (isBlack(p.pitch)) continue;
      const t0 = p.onKey + CFG.foldAfter, t1 = p.off;
      if (t1 <= t0) continue;
      const c = V(p.xs, keySurfaceY(p.pitch, p.zs, 1), p.zs), kb = [p.pitch - 1, p.pitch + 1].filter((b) => isBlack(b)), beta = pqOf(p).beta[f], dip = pqOf(p).dip;
      const slot = kb.length && p.zs < CFG.slotZ + CFG.slotHold;
      const st = (t) => {
        const F = frameAt(h, t, true).F, l = F.local(c), ahead = baseL(F, f)[2] - l[2];
        if (!slot) return [ahead, 0];
        const m = knuckle(F, f, c), dh = Math.hypot(c.x - m.x, c.z - m.z) || 1, fwd = V((c.x - m.x) / dh, 0, (c.z - m.z) / dh);
        return [ahead, skinInBlack(f, p.pitch, solveChain(m, tipTarget(f, c, fwd, beta), SEG[f], 1.9, F.ax.y, dip))];
      };
      const s0 = st(t0)[1];
      for (let t = t0; t < Math.min(t1, t0 + CFG.foldScan); t += CFG.foldStep) {
        const [a, sk] = st(t);
        if (a < CFG.foldAhead || sk > Math.max(CFG.skinLet, s0 + CFG.skinMore)) { const o2 = Math.max(p.onKey + CFG.foldAfter, t); if (o2 < p.off) { p.off = o2; p.ride = 0; } break; }
      }
    }
  }));
  // (curl round) And a finger 2-5 on any key lets go once the hand, moving on, would bend it more than curlHeld (its key
  // brought in under the knuckle): it lifts off instead of hooking, the pedal holding the sound.
  plan.forEach((H, h) => H.presses.forEach((pr, f) => {
    if (!f) return;
    for (const p of pr) {
      const t0 = p.onKey + CFG.curlAfter, t1 = p.off;
      if (t1 <= t0) continue;
      const Q = pqOf(p), need = curlD(f, curlOf(CFG.curlHeld, Q), Q.dip) - LSUM[f], short = shortOf(h, f, p);
      for (let t = t0; t < t1; t += CFG.curlStep) if (short(t) < need) { if (t < p.off) { p.off = t; p.ride = 0; } break; }
    }
  }));
  plan.forEach((H) => H.presses.forEach((pr) => pr.forEach((p) => { p.floor0 = Math.min(p.floor, p.onKey + PATH.hurryHold); delete p.floor; })));
  across = null;

  // ---- each press's key profile (FINAL-SPEC S2.2): the key starts down as fast as the fingertip lands (V_land, from the
  // note's loudness and how fast the music around it goes), p = V_land d / Dz with Dz the key's travel at the strike point,
  // between 1 and 2.5. The music's local rate: one over the median time between this hand's events within 4 either side.
  plan.forEach((H) => {
    const ev = H.events, rate = ev.map((e, i) => {
      const d = []; for (let j = Math.max(0, i - 4); j < Math.min(ev.length - 1, i + 4); j++) d.push(ev[j + 1].t - ev[j].t);
      d.sort((a, b) => a - b);
      return 1 / clamp(d.length ? d[d.length >> 1] : 1, 0.05, 1.0);
    });
    const evOf = new Map(); ev.forEach((e, i) => e.notes.forEach((n) => evOf.set(n, i)));
    for (const pr of H.presses) for (const p of pr) {
      const vLand = clamp(10 + 20 * p.vel, 10, 30) * (0.6 + 0.4 * smoothstep(1.5, 5, rate[evOf.get(p.note)] ?? 1));
      const Dz = p.zs * Math.sin(isBlack(p.pitch) ? KEY_TILT.black : KEY_TILT.white);
      p.p = clamp((vLand * p.d) / Math.max(1e-3, Dz), 1, 2.5);
    }
  });
  // ---- the keys: each one's depth at t is the deepest of its presses' (both hands; a key struck again while it is still
  // rising goes down again from where it is). byKey: its presses in order of contact, with the latest end (release + RET)
  // so far, so that the search back stops at the first press already over.
  const byKey = new Map();
  for (const [pitch, L] of byPitch) {
    const S = L.slice().sort((a, b) => a.tc - b.tc), end = new Float64Array(S.length);
    S.forEach((p, i) => { end[i] = Math.max(i ? end[i - 1] : -Infinity, p.off + CFG.RET); });
    byKey.set(pitch, { S, end });
  }
  function keyDepth(pitch, t) {
    const K = byKey.get(pitch); if (!K) return 0;
    const { S, end } = K;
    let lo = 0, hi = S.length - 1, k = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (S[m].tc <= t) { k = m; lo = m + 1; } else hi = m - 1; }
    let v = 0;
    for (let j = k; j >= 0 && end[j] > t; j--) { const d = pressDepth(S[j], t); if (d > v) { v = d; if (v >= 1) break; } }
    return v;
  }

  // (fast: a rougher pose, one IK pass without the pad's exact place, for the two hands' first scan for touching, S5)
  // (scan: for the two hands' scan for touching, S5: one exact pass, without lifting free fingers out of the black keys)
  // (curl round) a free finger's tip joint target T carried out until it is at least e1 from its knuckle m, softly from e0
  // (the curl limit, CFG.curlFree): straight out along the hand (its forward direction, level), at T's height, so that it
  // spreads no further across the hand. Carried out over the black keys, it rises over them as a fingertip in the air does
  // (its pad liftDeep above their tops, eased in from blackClear; curl fix: in full once carried curlLift out, so that it
  // does not dip into each black key the hand slides it across). One exact push, then the rise: pushed out again for the
  // rise, the push fed on itself and the fingertip stepped up to 1.3 in 1/600 s, Revolutionary's right index at 6.007 s.
  function curlOut(T, m, e1, e0, F, below) {
    const ah = Math.hypot(F.ax.z.x, F.ax.z.z) || 1, ux = -F.ax.z.x / ah, uz = -F.ax.z.z / ah;
    const vx = T.x - m.x, vy = T.y - m.y, vz = T.z - m.z, d = Math.hypot(vx, vy, vz);
    if (d >= e0) return;
    const want = e0 - (e0 - e1) * Math.tanh((e0 - d) / (e0 - e1));
    const vu = vx * ux + vz * uz, s = -vu + Math.sqrt(Math.max(0, vu * vu - (d * d - want * want)));
    T.x += s * ux; T.z += s * uz;
    const clr = BLACK_TOP + CFG.liftDeep + below, wb = ease((CFG.blackClear - T.z) / 0.3) * smoothstep(0, CFG.curlLift, s);
    if (wb > 0 && T.y < clr) T.y += (clr - T.y) * wb;
  }
  function poseHand(h, t, fast = false, scan = false) {
    const H = plan[h], side = H.side;
    const { F, elbow } = frameAt(h, t), O = F.O, Qt = PQ(h, t);
    // the plane each finger bends in: fingers 2-5 bend toward the palm; the thumb bends down and in toward the fingers,
    // so that it plays on its side with its nail facing up and out
    const up = F.ax.y;
    // (FINAL-SPEC S1.2 asked to check this vector's x sign: with -1 the thumb's middle joints bulge outward and up, away
    // from the fingers, so it curls in toward them, as a thumb does; with +1 it curls outward. Checked in close renders.)
    const upThumb = up.clone().multiplyScalar(0.55).addScaledVector(F.rot([-1, 0.3, 0.2]).normalize(), 0.83).normalize();
    const joints = [], heat = [0, 0, 0, 0, 0];
    for (let f = 0; f < 5; f++) {
      const pr = H.presses[f];
      // the last press whose contact has begun, and the next: the fingertip's path is continuous through them all
      let lo = 0, hi = pr.length - 1, k = -1;
      while (lo <= hi) { const m = (lo + hi) >> 1; if (pr[m].tc <= t) { k = m; lo = m + 1; } else hi = m - 1; }
      const prev = pr[k], next = pr[k + 1];
      // Everything below places the fingertip's lowest skin, its contact point cp (FINAL-SPEC S2.4); the tip joint's target
      // follows from it (tipTarget). A free fingertip's place in the hand: its own key width across (REST), at its natural
      // white-key depth (zWhite), turned with the hand's yaw about the knuckle (so the free thumb stays within its reach when
      // the hand turns: its base is 3 units behind the knuckles and swings the other way) but never in front of the keys,
      // its lowest skin hovering hoverY above the white keys, a little higher over the black keys. (The free thumb: its tip
      // joint where S1 held it, thumbRestY above the white keys; its lowest skin then lies thumbContact from it. Placed as a
      // contact point at the tip joint's old place, the thumb, which plays on its side, would reach about 1.2 beyond its
      // length.)
      // (S5: a free thumb, with the other hand close, rests thumbTuck in toward its own fingers)
      const ox = side * (REST[f] + (f === 4 ? F.fan || 0 : f === 3 ? 0.4 * (F.fan || 0) : f === 0 ? CFG.thumbTuck * (F.close || 0) : 0)), oz = (Qt.zTip[f] - Qt.Z0) * (f && !Qt.legacy ? 1 + CFG.restQ[0] * Qt.w : 1), cy = Math.cos(F.yaw), sy = Math.sin(F.yaw);
      const rz = Math.min(O.z - sy * ox + cy * oz, CFG.zWhite[0] + Math.min(0, F.zOff || 0) + (f ? 0 : side > 0 ? -CFG.thumbIn * (F.close || 0) : Math.max(0, F.zOff || 0)));
      const rest = V(O.x + cy * ox + sy * oz, (f ? CFG.hoverY : CFG.thumbRestY) + (CFG.hoverBlack + (Qt.legacy ? 0 : CFG.hoverBlackQ - CFG.restQ[1] * Qt.w)) * ease((CFG.blackClear - rz) / 0.3) + (F.yOff || 0), rz);
      if (!f) { rest.add(F.rot([CFG.thumbContact[0], 0, 0])); rest.y -= CFG.thumbContact[1]; rest.z += CFG.thumbContact[2]; }
      // on its key: the key's surface at the strike point, as deep as the key is at s (it goes down from the contact, and up
      // after the release). After the release (off) the pad lets its key up: it eases rideUp off the key's surface over
      // 0.02 s, so that no skin stays inside the rising key (a flat finger's skin under its last joint lies as low as its pad).
      const down = (p, s) => V(p.xs, keySurfaceY(p.pitch, p.zs, keyDepth(p.pitch, s)) + (s > p.off ? CFG.rideUp * ease((s - p.off) / 0.02) : 0), p.zs);
      // (lifted above a white key struck near the black keys' fronts: above the black keys, so the finger does not touch them)
      // (lower in the lyrical posture: Qt.lift)
      const lifted = (p) => V(p.xs, !isBlack(p.pitch) && p.zs < CFG.slotZ + 0.05 ? BLACK_TOP + CFG.liftDeep : keyTop(p.pitch) + (isBlack(p.pitch) ? CFG.liftUpBlack : CFG.liftUp) * Qt.lift, p.zs);
      // the point above the key it has let go of (or is going to strike), carried along with the hand from the moment it let
      // go (or until it strikes): the finger moves with the hand, not toward a key the hand has left (or not yet reached)
      const carried = (p, s) => F.W(frameAt(h, s, true).F.local(lifted(p)));
      let cp, kFree = 0, nK = null, tFa = -1e9, tFb = 1e9, Sp = null, Sn = null, cE = null;
      const held = prev && t < prev.off + prev.ride;
      if (held) {                                       // on its key, from the contact until it has ridden up with it after the release
        cp = down(prev, t);
        nK = keyNormal(prev.pitch, keyDepth(prev.pitch, t));
      } else {
        const tA = prev ? prev.off + prev.ride : -1e9, tB = next ? next.tc : 1e9;
        tFa = tA; tFb = tB;
        const wr = Math.min(0.08, (tB - tA) * 0.4), wd = Math.min(0.07, (tB - tA) * 0.4);
        const A = prev ? carried(prev, tA) : null, B = next ? carried(next, tB) : null;
        // (curl fix: the contact points of its last and next key, carried with the hand, for the curl limit below)
        if (f && !scan) {
          if (A) { Sp = A.clone(); Sp.y -= lifted(prev).y - down(prev, tA).y; }
          if (B) { Sn = B.clone(); Sn.y -= lifted(next).y - down(next, tB).y; }
        }
        if (prev && next && tB - tA < 0.6) {           // straight on to the next key, in an arc
          const u = ease((t - tA) / (tB - tA));
          // (S4: around a leap (its last key let go of as the hand set off, or its next key at the leap's end), a finger 2-5 whose
          // key it left, or its next key, lies beyond airReach[0] of its length from its knuckle in the hand (all of it from
          // airReach[1]) is drawn toward its place in the hand on the way, most half-way. The path now sets
          // off for a leap as the last key goes down: Op. 25's left little finger, after A-flat1 at 0.59 s, pointed straight
          // back at the bass for the whole half beat until its next bass note, the hand two octaves away.)
          const K = f ? F.W(baseL(F, f)) : null, st = f && (H.events[prev.ev].hurry || H.events[next.ev].leap) ? smoothstep(CFG.airReach[0], CFG.airReach[1], Math.max(A.distanceTo(K), B.distanceTo(K)) / LSUM[f]) : 0;
          cp = A.lerp(B, u); cp.y += Math.sin(Math.PI * u) * CFG.arcUp * Math.min(1, Math.abs(B.x - A.x) / 2);
          // (S4 fix: from the start of the flight, eased in over airIn s, not half-way: after a hurried departure the finger
          // was left pointing back at its key for a third of the flight, Op. 25's left little finger at 0.59-0.62 s)
          if (st > 0) cp.lerp(rest, st * ease((t - tA) / CFG.airIn) * ease((tB - t) / Math.max(CFG.airIn, 0.4 * (tB - tA))));
        } else {                                        // back toward its place in the hand, and out again in time
          cp = rest.clone();
          if (prev) cp = A.lerp(rest, ease((t - tA) / 0.3));
          if (next) cp.lerp(B, 1 - ease((tB - t) / 0.3));
        }
        // (S5: passing over the other hand in a crossing, drawn in to its place in the hand, by the arc's own easing)
        // (S5 fix: eased in from the release and out by the next strike, so the fingertip does not snap)
        if (F.tuck > 0) { const tw = Math.min(PATH.tuckIn, 0.5 * (tB - tA)); cp.lerp(rest, Math.min(1, F.tuck) * ease(Math.min((t - tA) / tw, (tB - t) / tw))); }
        // (a finger in the air turns little more than sideFree[0] sideways at its knuckle, never sideFree[1]: it does not
        // swing across toward a key the hand has left or not yet reached; this eases off as it leaves or strikes a key)
        const k = ease(Math.min((t - tA) / wr, (tB - t) / wd));
        let l = F.local(cp);
        kFree = k;
        // (posture presets: a fingertip in the air stays at least hHook in front of its knuckle, as it would on a black key:
        // a key it let go of in front of the black keys, carried along as the hand comes forward over them, would otherwise
        // be under or behind the knuckle and the finger fold back under the hand; lifted by as much as it is drawn forward)
        if (f > 0 && !Qt.legacy && k > 0) {
          const K = MCP_L[f], ahead = K[2] - l[2], need = Qt.hHook[f] - ahead;
          if (need > 0) { cp = F.W([l[0], l[1] + 0.5 * k * need, l[2] - k * need]); l = F.local(cp); }
        }
        if (f > 0) {
          const K = MCP_L[f], lx = l[0] - K[0], lz = l[2] - K[2], r = Math.hypot(lx, lz);
          const a = Math.atan2(Math.abs(lx), -lz), a0 = CFG.sideFree[0], a1 = CFG.sideFree[1];
          // (fingers round 2: less the nearer it lies straight behind or in front of its knuckle, where the side it turns to
          // flips: Cornfield Chase's left index finger, let go of D4 at 110.31 s behind its knuckle, jumped 0.9 in 1/600 s)
          const kk = k * smoothstep(0, CFG.sideFlip, Math.abs(lx));
          if (kk > 0 && r > 1e-6 && a > a0) {
            const b = a0 + (a1 - a0) * Math.tanh((a - a0) / (a1 - a0)), c = a + kk * (b - a);
            cp = F.W([K[0] + Math.sign(lx) * r * Math.sin(c), l[1], K[2] - r * Math.cos(c)]);
          }
          // (fingers round 1) nor does it reach more than spreadFree beyond its natural spread (its rest place across the hand,
          // fanned) toward a key the hand has left or not yet reached, softly; eased in over spreadIn[0] s after it lets go, and
          // out over the last spreadIn[1] s before it strikes. (Cornfield Chase's left little finger at 103.5 s, free, pointed
          // straight out at G1 1.2 beyond its reach while the hand had moved on.)
          const l2 = F.local(cp), nat = REST[f] + (f === 4 ? F.fan || 0 : f === 3 ? 0.4 * (F.fan || 0) : 0) + CFG.spreadRest;
          const dir = f === 1 ? -1 : f === 2 ? Math.sign(l2[0] - nat) : 1, e = dir * (l2[0] - nat), s = CFG.spreadFree;
          const ks = ease(Math.min((t - tA) / CFG.spreadIn[0], (tB - t) / CFG.spreadIn[1]));
          if (ks > 0 && e > 0) cp = F.W([l2[0] - dir * ks * (e - s * Math.tanh(e / s)), l2[1], l2[2]]);
        } else {
          // (nor does a free thumb stretch out past its reach, BANDS.N, toward a key the hand has left or not yet reached: it
          // would hang straight out in front of the keys)
          const u0 = REST[0] + BANDS.N[0][0], s0 = CFG.thumbFree;
          const kt = ease(Math.min((t - tA) / CFG.thumbFreeT, (tB - t) / CFG.thumbFreeT));
          if (kt > 0 && l[0] < u0) cp = F.W([l[0] + kt * (u0 - s0 * Math.tanh((u0 - l[0]) / s0) - l[0]), l[1], l[2]]);
        }
        // (over the black keys, a fingertip in the air keeps above their tops: carried along as the hand comes forward, it
        // would otherwise sweep through them)
        const clr = BLACK_TOP + CFG.liftDeep, wb = ease((CFG.blackClear - cp.z) / 0.3);
        if (cp.y < clr && wb > 0) cp.y += (clr - cp.y) * wb;
        // (fingers round 1) nor does it go below freeFloor above the white keys, away from a key it leaves or strikes (k): a key
        // it let go of while the hand was lifted over the other (S5), carried along as the hand came down again, took the
        // fingertip into the keys beside it (Interstellar's right little finger, 0.13 into D5 at 115.0 s)
        if (cp.y < WHITE_TOP + CFG.freeFloor) cp.y += (WHITE_TOP + CFG.freeFloor - cp.y) * k;
        // (and a free finger 2-5 stays over the keys, freeFront in from their front edge at most: carried along as the hand
        // turned and moved on, Cornfield Chase's left little finger, let go of G1 at 101.47 s, lay out sideways in front of
        // the keys)
        if (f && cp.z > CFG.freeFront) cp.z += (CFG.freeFront - cp.z) * k;
        // the key lets the finger up as it is released, and the finger strikes down onto the next (where the key is then)
        if (prev && t - tA < wr) cp.y += (down(prev, tA).y - cp.y) * (1 - (t - tA) / wr);
        if (next && tB - t < wd) cp.y += (down(next, tB).y - cp.y) * (1 - (tB - t) / wd);
        // (S3) a thumb comes down onto a black key from above: still in the air, its side lies lower than its pad, and
        // carried in sideways by the hand it went into the key's side first (Fantaisie 75.53 s). The lift eases in from 2 wd
        // before the contact, is whole wd before it and eases out by the contact, so the thumb's path stays smooth (2 wd is at
        // most 0.8 of its time in the air). (S3 fix: it was whole at wd and nothing just before, a jump of 0.2 at each start.)
        if (!f && next && isBlack(next.pitch) && tB - t < 2 * wd) cp.y += CFG.thumbBlackLift * ease(Math.min((tB - t) / wd, 2 - (tB - t) / wd));
        // (while it leaves a key, or comes down onto the next, a fingertip the hand has already carried sideways off that key
        // keeps sideClear above the keys beside it: the white keys' tops, and over the black keys their clearance, or from a
        // black key their tops: the next black key is as high as its own)
        // (S4: faded out by the end of the window: cut off there, it made the fingertip jump up to 0.16 for one or two
        // hundredths of a second where the new path carries a finger sideways in a short flight; Moonlight's left little
        // finger at 131-149 s, 146 of the 188 single-sample spikes)
        for (const [p, near, fade] of [[prev, prev && t - tA < wr, 1 - (t - tA) / wr], [next, next && tB - t < wd, 1 - (tB - t) / wd]]) {
          if (!near) continue;
          const b = isBlack(p.pitch), w = smoothstep(b ? 0.1 : 0.2, b ? 0.3 : 0.45, Math.abs(cp.x - p.xs)) * ease(2 * fade);
          const fl = Math.max(WHITE_TOP + CFG.sideClear, wb * (b ? BLACK_TOP + CFG.sideClear : clr));
          if (w > 0 && cp.y < fl) cp.y += (fl - cp.y) * w;
        }
        // (S4 fix) a fingertip leaving the narrow part of a white key between the black keys, or striking into it, keeps to
        // it until it is above the black keys beside it: only then does the hand carry it sideways
        if (f) for (const [p, near, fade, rel] of [[prev, prev && t - tA < wr, 1 - (t - tA) / wr, true], [next, next && tB - t < wd, 1 - (tB - t) / wd, false]]) {
          if (!near || isBlack(p.pitch) || p.zs >= CFG.slotZ + (Qt.legacy ? 0 : CFG.slotHold)) continue;
          // (fingers round 2: as it leaves, by the time since it let go alone, not by its height too: rising fast, as the
          // finger let go of D4 it swung across 2 units in 0.006 s, Cornfield Chase's left index finger at 110.33 s)
          const k = (rel && !Qt.legacy ? 1 : 1 - smoothstep(CFG.slotUp[0], CFG.slotUp[1], cp.y)) * ease(2 * fade);
          if (k > 0) cp.x += (p.xs - cp.x) * k;
        }
        // (the pad meets a key along its normal: eased in from the world's up as the finger strikes, and out as it leaves)
        if ((prev && t - tA < wr) || (next && tB - t < wd)) {
          nK = V(0, 1, 0);
          if (prev && t - tA < wr) nK.lerp(keyNormal(prev.pitch, keyDepth(prev.pitch, t)), 1 - (t - tA) / wr);
          if (next && tB - t < wd) nK.lerp(keyNormal(next.pitch, keyDepth(next.pitch, t)), 1 - (tB - t) / wd);
          nK.normalize();
        }
      }
      if (prev && t >= prev.on && t < prev.off) heat[f] = 0.55 + 0.45 * Math.exp(-(t - prev.on) / 0.35);
      const m = knuckle(F, f, cp);
      // (a thumb stretched nearly straight from its low base would lie across the next key: in the air it is held a little
      // higher, eased in after it leaves a key and out before it strikes; on its key the pad rides the key)
      if (f === 0) cp.y += kFree * CFG.thumbStraight * clamp((cp.distanceTo(m) / LSUM[0] - 0.9) / 0.07, 0, 1);
      // The tip joint's target, from the contact point (FINAL-SPEC S2.4): a first pass from the pad table at a usual angle
      // (beta0), then the final one from the pad's lowest skin as the mesh is posed by the first pass (the table, by the
      // first pass's angle, without the model). Only the final pass goes through solveFinger, and its joints are kept as
      // they are (the measuring tool knows each finger's target by them).
      const upF = f === 0 ? upThumb : up, maxB = f === 0 ? 1.2 : 1.9;
      const dh = Math.hypot(cp.x - m.x, cp.z - m.z) || 1, fwd = V((cp.x - m.x) / dh, 0, (cp.z - m.z) / dh);
      const dip = f ? Qt.dip : 0.5;
      let J = solveChain(m, tipTarget(f, cp, fwd, Qt.legacy || !f ? CFG.beta0[f] : Qt.beta[f]), SEG[f], maxB, upF, dip);   // (posture presets: from the posture's own angle)
      if (!fast && !scan) for (let i = 1; i < CFG.ikPasses - 1; i++) J = solveChain(m, tipTargetExact(f, cp, J, F, nK) || tipTarget(f, cp, fwd, distalBeta(J)), SEG[f], maxB, upF, dip);
      // (fingers round 2: the touching scan takes the pad table here too: the exact pad was half its time, and createHands
      // was 30 % slower than before the posture work, Gymnopedie)
      const T = (!fast && !scan && tipTargetExact(f, cp, J, F, nK)) || tipTarget(f, cp, fwd, distalBeta(J));
      // (in the air the pad's place under the tip joint is taken at the finger's usual playing angle, eased in as it leaves
      // a key and out as it strikes: as posed, a finger pointing up has its lowest skin at the near end of its last bone,
      // and the thumb, aimed 1 unit further on, would stretch up and out of reach)
      if (kFree > 0) {
        const Tn = f ? tipTarget(f, cp, fwd, Qt.beta[f]) : cp.clone().sub(F.rot([CFG.thumbContact[0], 0, 0])).add(V(0, CFG.thumbContact[1] - CFG.squash, -CFG.thumbContact[2]));
        T.lerp(Tn, kFree);
      }
      // (a target out of the finger's reach: stretched straight toward a contact on the key's surface, the finger would lie
      // across the keys beside it; it aims higher, by about how far it falls short, so that it still falls short and its
      // tip hangs over its key. FINAL-SPEC S3 and S4 bring the hand within reach.)
      // (fingers round 1) a free finger is never stretched straight: its tip joint stays within freeReach[0] of its length from
      // its knuckle, softly up to freeReach[1], from the moment it lets go (a finger already beyond reach as it lets go springs
      // back) and eased out over freeIn s before its next contact (a finger
      // carried away from the key it has just let go of, or reaching ahead for its next key, pointed straight out at it:
      // Cornfield Chase's left thumb at 101.38 s, its little finger at 101.55 s)
      // (fingers round 2: eased in over freeOut s after it lets go, as well: taken in full at once, a finger straight on its
      // key as it let go curled in one step, a jump of up to 0.9 in 1/600 s: Cornfield Chase's left thumb leaving D4 at
      // 97.33 s. And its tip joint kept over the keys, freeFront in from their front edge, as the contact point above: the
      // freed little finger's tip hung in front of the keys, Cornfield Chase 101.5 s)
      if (!held) {
        // (curl round, curl fix: for fingers 2-5 the curl limit's band instead of freeReach, CFG.curlFree; freeReach stays for
        // the thumb and for the two hands' touching scan (scan), whose remedies, worked out from the relaxed fingers, changed
        // where a hand was lifted and let a key go early: Clair de lune's right middle finger on A-flat3 at 37.1 s hung straight)
        const d = T.distanceTo(m);
        if (!f || scan) {
          const kd = ease(Math.min((tFb - t) / CFG.freeIn, (t - tFa) / CFG.freeOut)), d0 = CFG.freeReach[0] * LSUM[f], d1 = CFG.freeReach[1] * LSUM[f];
          if (kd > 0 && d > d0) { const dn = d0 + (d1 - d0) * Math.tanh((d - d0) / (d1 - d0)); T.sub(m).multiplyScalar(1 + kd * (dn / d - 1)).add(m); }
        } else {
          // the bend it has at its last release and its next contact: Sp and Sn, those keys' contact points carried with the
          // hand, with the tip joint where it is now relative to the pad (dP, dN: knuckle to tip joint there)
          const ox = T.x - cp.x, oy = T.y - cp.y, oz = T.z - cp.z, dS = (S) => Math.hypot(S.x + ox - m.x, S.y + oy - m.y, S.z + oz - m.z);
          const dP = Sp ? dS(Sp) : 0, dN = Sn ? dS(Sn) : 0;
          const c0 = curlOf(CFG.curlFree[0], Qt), c1 = curlOf(CFG.curlFree[1], Qt);
          const s0 = curlD(f, c0 + CFG.curlSoft, dip), s1 = curlD(f, c0, dip), r0 = curlD(f, c1 - CFG.curlSoft, dip), r1 = curlD(f, c1, dip);
          const kP = Sp ? 1 - ease((t - tFa) / (CFG.curlBack * CFG.freeOut)) : 0, kN = Sn ? 1 - ease((tFb - t) / (CFG.curlBack * CFG.freeIn)) : 0;
          const d0 = s0 + Math.max(kN * Math.max(0, dN - s0), kP * Math.max(0, dP - s0)), d1 = d0 + s1 - s0;
          if (d > d0) { const dn = d0 + (d1 - d0) * Math.tanh((d - d0) / (d1 - d0)); T.sub(m).multiplyScalar(dn / d).add(m); }
          // the roundest end: the bend at those keys (eS, from one to the other across the flight), eased to curlFree[1]
          const sl = (dK) => CFG.curlSlack[0] * LSUM[f] * (1 - smoothstep(CFG.curlSlack[1], CFG.curlSlack[2], dK / LSUM[f])), eP = Math.min(r0, dP - sl(dP)), eN = Math.min(r0, dN - sl(dN)), eS = Sp && Sn ? eP + (eN - eP) * ease((t - tFa) / (tFb - tFa)) : Sp ? eP : Sn ? eN : r0;
          const [q0, q1] = CFG.curlRelax, rP = q0 + q1 * (r0 - eP) / LSUM[f], rN = q0 + q1 * (r0 - eN) / LSUM[f];
          const e0 = eS + (r0 - eS) * ease5(Math.min((t - tFa) / rP, (tFb - t) / rN)) * smoothstep(CFG.curlSpan[0], CFG.curlSpan[1], tFb - tFa);
          cE = [e0 - (r0 - r1), e0];
          curlOut(T, m, cE[0], cE[1], F, padLookup(f, Qt.beta[f]).below);
        }
        if (f && T.z > CFG.freeFront) T.z += (CFG.freeFront - T.z) * kFree;
      }
      // (fingers round 2) a finger 2-5 on its key is never dead straight: its tip joint stays within heldReach of its length
      // from its knuckle, softly (by heldSoft), drawn in along the key: the pad then lies at most that much off its contact point. (Lyrical: the
      // right little finger held B5 in Cornfield Chase at 103.5 s with its middle and last joints at 0 deg.)
      if (held && f) {
        const d = T.distanceTo(m), r0 = (CFG.heldReach - CFG.heldSoft) * LSUM[f], s = CFG.heldSoft * LSUM[f];
        if (d > r0) {
          // (drawn in along the key at its own height, so that the pad stays on the key's surface)
          const dn = r0 + s * Math.tanh((d - r0) / s), dy = T.y - m.y, hx = T.x - m.x, hz = T.z - m.z, hh = Math.hypot(hx, hz) || 1;
          if (dn > Math.abs(dy)) { const kh = Math.sqrt(dn * dn - dy * dy) / hh; T.x = m.x + hx * kh; T.z = m.z + hz * kh; }
        }
      }
      const short = T.distanceTo(m) - LSUM[f];
      if (short > 0 && CFG.liftMax > 0) T.y += (1 - kFree) * CFG.liftMax * Math.tanh(short / CFG.liftMax);
      // (fingers round 1) posture presets: a finger in the air whose skin, as posed, goes into a black key is lifted out of
      // it (by how far its deepest skin there lies below the key's top, at most twice), eased in over skinIn s after it lets
      // go of a key and out before it strikes. (Carried along by the hand as it leaves a key or comes down onto the next, a
      // flat finger's last bone swept through the black keys beside it: Moonlight 3's right middle finger, 0.25 into
      // C-sharp4 at 287.1 s.)
      if (!fast && !scan && f && !Qt.legacy && !held) {
        const kq = ease(Math.min((t - tFa) / CFG.skinIn, (tFb - t) / CFG.skinIn));
        if (kq > 0) {
          J = solveChain(m, T, SEG[f], maxB, upF, dip);
          for (let it = 0; it < 2; it++) {
            const x = J[3].x, kb = BLACKS.filter((b) => Math.abs(KX[b] - x) < 1.1);
            const sk = kb.length ? skinInBlack(f, 0, J, kb) : 0;
            if (sk <= CFG.skinFree) break;
            // (curl fix: eased in over skinRamp, not at once: a fingertip slid across the black keys jumped up and down by
            // 0.1 at each one, Gymnopedie's left middle finger at 33.3 s)
            T.y += kq * (skinUp + CFG.skinClear) * smoothstep(CFG.skinFree, CFG.skinFree + CFG.skinRamp, sk);
            J = solveChain(m, T, SEG[f], maxB, upF, dip);
          }
        }
      }
      // (curl round) lifted out of a black key, it is carried out along the hand again, at its new height, so that it does not
      // curl more for being lifted
      if (cE && !Qt.legacy && !fast) curlOut(T, m, cE[0], cE[1], F, padLookup(f, Qt.beta[f]).below);
      // (fingers round 2) a finger 2-5 holding a white key whose last bone, as posed, goes into a black key beside it stands
      // steeper on its pad, its pad where it was: skinSteep per unit its skin lies inside, at most skinSteepMax, twice (a
      // continuous function of the pose, so it does not snap). (Its flat last bone reached back under the black key, or
      // into its side: Moonlight 3's right middle finger on G3 at 244.8 s, 0.15 into G-sharp3.)
      if (!fast && !scan && f && held && !isBlack(prev.pitch) && prev.zs < CFG.slotZ + CFG.slotHold) {
        let b = null;
        for (let it = 0; it < 2; it++) {
          const Js = solveChain(m, T, SEG[f], maxB, upF, dip), d = skinInBlack(f, prev.pitch, Js) - CFG.skinFree;
          if (d <= 0) break;
          if (b == null) b = distalBeta(Js);
          b = Math.min(b + Math.min(CFG.skinSteepMax, CFG.skinSteep * d), 1.35);
          const T2 = tipTarget(f, cp, fwd, b);
          if (T2.y > T.y) T.copy(T2);
        }
      }
      // (fingers round 2) and a finger 2-5 never folds back under its knuckle: its tip joint stays at least foldMin in front
      // of it along the hand, softly. (Where the hand comes forward over a key its finger still holds, the IK turned the
      // finger over backwards, its knuckle bent 170 deg: Moonlight 3's right middle finger on C5 at 290.1 s.)
      if (f) {
        const lT = F.local(T), K = baseL(F, f), a = K[2] - lT[2], s = CFG.foldSoft;
        if (a < CFG.foldMin + 6 * s) { const a2 = CFG.foldMin + s * Math.log1p(Math.exp((a - CFG.foldMin) / s)); T.copy(F.W([lT[0], lT[1], K[2] - a2])); }
      }
      J = fast || scan ? solveChain(m, T, SEG[f], maxB, upF, dip) : solveFinger(m, T, SEG[f], maxB, upF, dip);
      joints.push(J);
    }
    const wrist = F.W(WRIST_L);
    // (toHand, world -> hand, is also the palm's frame in the shader)
    return { joints, wrist, elbow, heat, side, toHand: F.toHand, O, yaw: F.yaw, pitch: F.pitch, roll: F.roll, fan: F.fan || 0 };
  }

  // ---- (S5) the hands kept from touching. With the paths apart, the crossings' posture and the close hands' depths, the
  // two hands can still touch where the notes bring them closer than G: two thumbs stretched toward each other's side,
  // each over a key beyond the other's (Op. 25 18.72 s: the right thumb on E flat 3 left of the left thumb on G3), a free
  // thumb against the other hand's, a crossing hand's fingers over the other's knuckles. There one hand is lifted (its
  // fingers on keys stay on them, reaching a little further down, while its thumb, palm and free fingers rise over the
  // other hand), or the hands move apart in depth (one thumb then passes in front of the other: FINAL-SPEC S5.4's close-
  // hands depths, as far as needed). Measured on the hands as posed, by their bones' capsules with the mesh's girths (one
  // hand's outer skin, r90, against the other's capsule, r25: as tools/hand-metrics.mjs counts hands that go into each
  // other), at apartDt s steps where the knuckles are less than apartNear apart or in a crossing; then again, apartRounds
  // rounds, near where they still touch. The remedy, for each stretch of touching: of the four (in a crossing, of the
  // crossing hand lifted or moved in), the one that parts the hands most when tried (apartTry) at its deepest touch. (Lifting
  // the hand whose bone lay higher there: the coin fell either way where both thumbs were at one height, and a hand whose
  // thumb reached under the other's palm was lifted in vain: Op. 25 18.72 s, Interstellar 163.3 s.)
  const apartMs = (() => {
    const tA = now();
    plan.apart = [];
    if (!both) return 0;
    // the capsules, in the hand's frame where they do not follow a finger's joints: [bone radius r25, r90]
    const RF = [[[0.57, 0.67], [0.37, 0.49], [0.25, 0.40]], [[0.30, 0.40], [0.30, 0.37], [0.22, 0.30]], [[0.33, 0.45], [0.29, 0.37], [0.25, 0.33]],
      [[0.30, 0.41], [0.28, 0.32], [0.23, 0.29]], [[0.26, 0.36], [0.24, 0.26], [0.21, 0.25]]];
    // (the metacarpals from their bases in the palm, as the model has them: handmesh.js PROPORTIONS moves them)
    const MB = ANATOMY && ANATOMY.meta ? ANATOMY.meta : [[0.71, -0.57, 3.11], [0.71, -0.57, 3.11], [1.56, -0.61, 2.64], [1.56, -0.61, 2.64]];
    const META = [[MB[0], 1, [0.50, 0.83]], [MB[1], 2, [0.39, 0.67]], [MB[2], 3, [0.50, 0.64]], [MB[3], 4, [0.39, 0.63]]];
    const capsOf = (h, t, fast) => {
      const P = poseHand(h, t, fast, true), F = frameAt(h, t, true).F, C = [];
      for (let f = 0; f < 5; f++) for (let k = 0; k < 3; k++) C.push([P.joints[f][k], P.joints[f][k + 1], RF[f][k]]);
      for (const [head, f, r] of META) C.push([F.W(head), P.joints[f][0], r]);
      const w0 = F.W(MB[0]);
      C.push([P.wrist, w0, [0.70, 0.98]]);
      const fa = P.elbow.clone().sub(P.wrist), L = fa.length();
      C.push([P.wrist, P.wrist.clone().addScaledVector(fa, Math.min(1, 5.3 / Math.max(L, 1e-6))), [0.97, 1.29]]);
      return C;
    };
    // (the closest distance between segments ab and cd)
    const segDist = (a, b, c, d) => {
      const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z, vx = d.x - c.x, vy = d.y - c.y, vz = d.z - c.z, wx = a.x - c.x, wy = a.y - c.y, wz = a.z - c.z;
      const A = ux * ux + uy * uy + uz * uz, B = ux * vx + uy * vy + uz * vz, Cc = vx * vx + vy * vy + vz * vz, D = ux * wx + uy * wy + uz * wz, E = vx * wx + vy * wy + vz * wz;
      const den = A * Cc - B * B;
      let s = den > 1e-12 ? clamp((B * E - Cc * D) / den, 0, 1) : 0, u = Cc > 1e-12 ? (B * s + E) / Cc : 0;
      if (u < 0) { u = 0; s = A > 1e-12 ? clamp(-D / A, 0, 1) : 0; } else if (u > 1) { u = 1; s = A > 1e-12 ? clamp((B - D) / A, 0, 1) : 0; }
      const px = wx + s * ux - u * vx, py = wy + s * uy - u * vy, pz = wz + s * uz - u * vz;
      return [Math.sqrt(px * px + py * py + pz * pz), a.y + s * uy, c.y + u * vy];
    };
    // how far the hands go into each other at t (0: not at all), and which hand lies on top there
    const touch = (t, extra = 0, fast = false) => {
      const C0 = capsOf(0, t, fast), C1 = capsOf(1, t, fast);
      let pen = 0, top = 0;
      for (const [a, b, ra] of C0) for (const [c, d, rb] of C1) {
        const need = Math.max(ra[1] + rb[0], ra[0] + rb[1]) + PATH.apartMargin + extra;
        if (Math.abs(a.x - c.x) > need + 6 && Math.abs(b.x - d.x) > need + 6) continue;
        const [dd, y0, y1] = segDist(a, b, c, d);
        if (need - dd > pen) { pen = need - dd; top = y0 >= y1 ? 0 : 1; }
      }
      return [pen, top];
    };
    const dt = PATH.apartDt, T0 = gT0, N = Math.ceil((gN * dtg) / dt) + 1;
    const inCross = (t) => crossings.findIndex((c) => t >= c.t0 - 0.2 && t <= c.t1 + 0.2);
    const need = [0, 1, 2, 3].map(() => new Float64Array(N)), who = new Int8Array(N).fill(-1), was = new Uint8Array(N + 1);
    let todo = [];
    const apartRuns = [], half = new Uint8Array(N);
    for (let i = 0; i < N; i++) { const t = T0 + i * dt; if (Math.abs(xAt(0, t) - xAt(1, t)) < PATH.apartNear || inCross(t) >= 0) todo.push(i); }
    // (S5 fix) whether hand h has a key down, or strikes one, about t: in a crossing, lifting the crossing hand further
    // while it plays leaves its fingers short of their keys and hanging down onto the other hand (Mozart's Fantasia 125.7
    // s), so there the remedies tried are scored apartPlay[1] worse for that. (Everywhere, it moved Op. 25's hands in
    // depth into the keys beside them: skin in other keys 9 -> 89.)
    const playing = (h, t) => plan[h].presses.some((pr) => {
      let lo = 0, hi = pr.length; while (lo < hi) { const m2 = (lo + hi) >> 1; if (pr[m2].tc <= t + PATH.apartPlay[0]) lo = m2 + 1; else hi = m2; }
      for (let j = lo - 1, n = 0; j >= 0 && n < 4; j--, n++) if (pr[j].off + pr[j].ride > t - 0.05) return true;
      return false;
    });
    // (first a scan with a rougher pose (poseHand's fast), apartScan wider: the rounds then look closely only near what it
    // finds)
    {
      const cand = new Uint8Array(N), w = Math.round(0.05 / dt);
      for (const i of todo) if (touch(T0 + i * dt, PATH.apartScan, true)[0] > 0) for (let j = Math.max(0, i - w); j <= Math.min(N - 1, i + w); j++) cand[j] = 1;
      todo = todo.filter((i) => cand[i]);
      // (fingers round 1) and half a step on, where the rough scan finds them that close there too: a touch can last one
      // video frame between two steps (Gymnopédie 112.75 s, Classical: the right thumb leaving C4 as the left index came in)
      for (const i of todo) if (touch(T0 + (i + 0.5) * dt, PATH.apartScan, true)[0] > 0) half[i] = 1;
    }
    const nH = Math.round(PATH.apartHold / dt), sg = PATH.apartSig / dt, kr = Math.ceil(3 * sg), ker = [];
    for (let j = -kr; j <= kr; j++) ker.push(Math.exp(-0.5 * (j / sg) ** 2));
    const ks = ker.reduce((a, b) => a + b, 0);
    for (let r = 0; r < PATH.apartRounds + PATH.apartLast[0] && todo.length; r++) {
      const cap = r < PATH.apartRounds ? PATH.apartMax : PATH.apartLast[1];
      const hit = [];
      // (next to where they touched in the round before, half-way to the next step as well: a touch can last one video frame)
      for (const i of todo) { const t = T0 + i * dt, pen = Math.max(touch(t)[0], half[i] || (r && (was[i] || was[i + 1] || (i && was[i - 1]))) ? touch(t + dt / 2)[0] : 0); if (pen > 0) hit.push([i, pen]); }
      was.fill(0); for (const [i] of hit) was[i] = 1;
      if (!hit.length) break;
      // stretches of touching (gaps under 0.2 s joined), each with its remedy: the one it had, else the best one tried
      const runs = [];
      for (const q of hit) { const l = runs[runs.length - 1]; if (l && (q[0] - l[l.length - 1][0]) * dt < 0.2) l.push(q); else runs.push([q]); }
      for (const run of runs) {
        let m = run.map(([i]) => who[i]).find((v) => v >= 0);
        const deep = run.reduce((a, q) => (q[1] > a[1] ? q : a)), t = T0 + deep[0] * dt;
        // (a new stretch, or one whose remedy is spent and still touching: the best remedy of those it has not had)
        if (m === undefined || need[m][deep[0]] >= cap - 1e-9) {
          // (never both hands lifted, nor moved in both ways: that undoes the first)
          const ci = inCross(t), had = run.flatMap(([i]) => [0, 1, 2, 3].filter((k) => need[k][i] > 0)), pair = (k) => (k < 2 ? 1 - k : 5 - k);
          const ch = ci >= 0 ? crossings[ci].hand : -1;
          const opts = (ch >= 0 ? [ch, ch ? 3 : 2] : [0, 1, 2, 3]).filter((k) => !had.includes(k) && !had.includes(pair(k)));
          let best = Infinity, mb;
          // (posture presets: tried at its full size too: a hand lifted by 1 that still touches the other may part from it by
          // 2.2 or not at all, as the right hand lifted over the left one sharing Fur Elise's E5 at 16.4 s, its thumb on the key)
          for (const k of opts) { let p = 0; for (const sz of LEG ? [PATH.apartTry] : [PATH.apartMax]) { apartTry[k] = sz; p += touch(t)[0]; } p += (ci >= 0 && k < 2 && playing(k, t) ? PATH.apartPlay[1] : 0); apartTry[k] = 0; if (p < best - 1e-9) { best = p; mb = k; } }
          if (mb === undefined) continue;
          if (m === undefined) { apartRuns.push(run); run.m = mb; }
          m = mb;
        }
        for (const [i, pen] of run) { need[m][i] = Math.min(cap, need[m][i] + PATH.apartGain * pen); who[i] = m; }
      }
      // the remedies' curves: each need held apartHold s each side, then eased
      for (let m = 0; m < 4; m++) {
        const held = new Float64Array(N);
        for (let i = 0; i < N; i++) if (need[m][i] > 0) for (let j = Math.max(0, i - nH); j <= Math.min(N - 1, i + nH); j++) held[j] = Math.max(held[j], need[m][i]);
        const c = new Float64Array(N + 8);
        for (let i = 0; i < N; i++) { let v = 0; for (let j = -kr; j <= kr; j++) { const q = i + j; if (q >= 0 && q < N) v += ker[j + kr] * held[q]; } c[i + 4] = v / ks; }
        apartOff[m] = c.some((v) => v > 0) ? { c, T0: T0 - 4 * dt, dt } : null;
      }
      // the next round: near where they touched
      const near = new Uint8Array(N), w = Math.round((r ? 0.05 : 0.15) / dt);
      for (const [i] of hit) for (let j = Math.max(0, i - w); j <= Math.min(N - 1, i + w); j++) near[j] = 1;
      todo = todo.filter((i) => near[i]);
    }
    // (plan.apart: each stretch where the hands would have touched: from, to, the remedy (0 / 1: the right / left hand
    // lifted, 2 / 3: the right / left hand in, the other out), the deepest overlap, the remedy's size)
    plan.apart = apartRuns.map((run) => {
      const t0 = T0 + run[0][0] * dt, t1 = T0 + run[run.length - 1][0] * dt;
      return { t0, t1, remedy: run.m, pen: Math.max(...run.map((q) => q[1])), size: Math.max(...run.map((q) => need[run.m][q[0]])) };
    });
    return now() - tA;
  })();

  // (fingers round 1) Where the hands were moved apart (above: a hand lifted over the other, or moved in or out), a key held
  // through it lets go once its finger is leaveFar beyond its length: Clair de lune's left middle finger on F4 at 37.0-40.2
  // s, its hand lifted 4 over the right hand in a crossing, hung straight 1.4 above its key, and the right hand's middle
  // finger passed through it.
  for (const a of plan.apart) plan.forEach((H, h) => H.presses.forEach((pr, f) => {
    for (const p of pr) {
      if (p.tc > a.t1 + 0.3 || p.off < a.t0 - 0.3) continue;
      const short = shortOf(h, f, p);
      for (let t = Math.max(p.floor0, a.t0 - 0.3); t < Math.min(p.off, a.t1 + 0.3); t += 0.01) if (short(t) > PATH.leaveFar) { p.off = t; p.ride = 0; break; }
    }
  }));
  if (plan.apart.length) for (const { S, end } of byKey.values()) S.forEach((p, i) => { end[i] = Math.max(i ? end[i - 1] : -Infinity, p.off + CFG.RET); });
  // which notes a finger actually plays, and for how long (a note no finger reaches is not shown as played): the sound at
  // `on`, the release at `off`, the fingertip on the key from tc, the key at the bottom from onKey
  // (a key struck twice within one event is one press: the second note is played by it too; hand: the hand that plays it,
  // which the rescue may have changed from the note's track)
  const played = new Map();
  for (const p of all) {
    const v = { on: p.on, off: p.off, tc: p.tc, onKey: p.onKey, d: p.d, p: p.p, hand: p.hand, finger: p.f };
    played.set(p.note, v);
    if (p.dups) for (const n of p.dups) played.set(n, { ...v, on: n.onset });
  }
  const kept = new Set(); for (const H of plan) for (const e of H.events) for (const n of e.notes) kept.add(n);
  // (droppedChord: notes no hand plays, from chords of more than 5 notes and, wideDropped of them, from chords wider than a
  // hand reaches even stretched (fingering.js OPT.stretchTol); rescueRefused: leap rescues refused because the note lay on
  // the giving hand's far side (fingering.js rescueLeaps); crossings: hand crossings, counted from S5)
  const dropped = plan.reduce((s, H) => s + H.events.reduce((a, e) => a + (e.dropped ? e.dropped.length : 0), 0), 0);
  const stats = { planMs: Math.round((now() - t0) * 10) / 10, unplayed: notes.filter((n) => !played.has(n)).length, droppedChord: dropped,
    droppedLeap: leaps.droppedLeap[0] + leaps.droppedLeap[1], late: leaps.late[0] + leaps.late[1], lunge: leaps.lunge[0] + leaps.lunge[1], rescued: plan.stats.rescued, rescueRefused: plan.stats.refused, crossings: crossings.length, unisons, spreadEvents: plan.stats.spreadEvents,
    stretched: plan.stats.stretched, wideDropped: plan.stats.wideDropped, classes: plan.stats.classes,
    leaps: leaps, moves: plan.map((H) => H.moves.length), pathMs: Math.round(pathMs * 10) / 10, apartMs: Math.round(apartMs * 10) / 10, pathIters, pathUnsettled };
  return { plan, played, pose: (t) => [poseHand(0, t), poseHand(1, t)], keyDepth, stats, keyLayout };
}

// ---------------------------------------------------------------- drawing: ray-marched hands
export const HAND_LOOKS = [
  { id: 'skin', name: 'Skin' },
  { id: 'glass', name: 'Glass' },
  { id: 'porcelain', name: 'Porcelain' },
];
const NF = 15; // finger bones (3 per finger)
const HAND_VERT = `
varying vec3 vW;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const HAND_FRAG = `
uniform mat4 projectionMatrix;
out highp vec4 outColor;
uniform vec4 uA[${NF}], uB[${NF}];            // finger bones: start (xyz, radius), end (xyz, radius)
uniform vec4 uNail[5], uNailD[5], uNailU[5];  // nails: centre (w: size), along the finger, up
uniform mat4 uToHand;                         // world -> the hand's own frame (mirrored for the left hand)
uniform vec3 uWrist, uElbow, uLight, uHotCol, uSkin;
uniform vec4 uHot[5];
uniform float uLook, uSleeve;                 // 0 skin, 1 glass, 2 porcelain; 1 = a sleeve on the forearm
uniform vec2 uFade;
varying vec3 vW;
float sdCone(vec3 p, vec3 a, vec3 b, float ra, float rb) {
  vec3 ba = b - a, pa = p - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - mix(ra, rb, h);
}
float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
float sdEll(vec3 p, vec3 r) { float k0 = length(p / r), k1 = length(p / (r * r)); return k0 * (k0 - 1.0) / k1; }
float sdRBox(vec3 p, vec3 b, float r) { vec3 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r; }
float nailField(vec3 p, int i) {
  vec3 q = p - uNail[i].xyz, d = uNailD[i].xyz, u = uNailU[i].xyz, s = cross(d, u);
  vec3 l = vec3(dot(q, s), dot(q, u), dot(q, d));
  float w = uNail[i].w;
  return sdEll(l, vec3(0.3, 0.075, 0.42) * w);
}
// the hand's surface: returns the distance; mat = 0 skin, 1 nail, 2 sleeve
float mapM(vec3 p, out float mat) {
  vec3 h = (uToHand * vec4(p, 1.0)).xyz;
  // the palm: a rounded slab, wider at the knuckles than at the wrist, a little domed on the back
  vec3 hp = h - vec3(0.32, -0.42, 2.15);
  hp.x *= mix(1.0, 1.22, clamp((hp.z + 2.1) / 4.2, 0.0, 1.0));
  hp.y += 0.08 * hp.x * hp.x;
  float d = sdRBox(hp, vec3(1.5, 0.36, 2.05), 0.34);
  d = smin(d, sdEll(h - vec3(-0.95, -0.62, 2.6), vec3(0.95, 0.55, 1.35)), 0.45);   // the thumb's muscle
  d = smin(d, sdEll(h - vec3(1.45, -0.6, 2.3), vec3(0.55, 0.5, 1.5)), 0.35);       // the little finger's side
  // the wrist and forearm (a little flattened), into the sleeve
  // (a man's wrist is about 6 cm across and 4 cm deep; the forearm widens to about 8 cm)
  vec3 ad0 = normalize(uElbow - uWrist), as0 = normalize(cross(ad0, vec3(0.0, 1.0, 0.0))), au0 = cross(as0, ad0);
  vec3 ap = p - uWrist; float aa = dot(ap, ad0);
  vec3 aq = uWrist + ad0 * aa + as0 * dot(ap, as0) + au0 * dot(ap, au0) * 1.5;   // squash the arm top to bottom
  float arm = sdCone(aq, uWrist - ad0 * 0.6, uElbow, 1.12, 1.9) / 1.5;
  d = smin(d, arm, 0.65);
  // the tendons on the back of the hand, fanning from the knuckles to the wrist
  for (int f = 1; f < 5; f++) {
    vec3 k0 = f == 1 ? vec3(-0.98, 0.16, 0.7) : f == 2 ? vec3(0.0, 0.2, 0.65) : f == 3 ? vec3(0.92, 0.15, 0.75) : vec3(1.62, 0.0, 1.0);
    vec3 k1 = vec3(0.05 + 0.32 * k0.x, 0.1, 4.0);
    d = smin(d, sdCone(h, k0, k1, 0.1, 0.08), 0.45);
  }
  // fingers: each bone, with its joints a little thicker (knuckles); the nails on top of the last bones
  for (int f = 0; f < 5; f++) {
    int i = f * 3;
    float g = sdCone(p, uA[i].xyz, uB[i].xyz, uA[i].w, uB[i].w);
    g = smin(g, sdCone(p, uA[i + 1].xyz, uB[i + 1].xyz, uA[i + 1].w, uB[i + 1].w), 0.07);
    g = smin(g, sdCone(p, uA[i + 2].xyz, uB[i + 2].xyz, uA[i + 2].w, uB[i + 2].w), 0.06);
    g = smin(g, length(p - uB[i].xyz) - uB[i].w * 1.04, 0.08);       // the middle knuckle
    d = smin(d, g, f == 0 ? 0.42 : 0.2);
    d = smin(d, length(p - uA[i].xyz - vec3(0.0, 0.06, 0.0)) - uA[i].w * 1.02, 0.08);  // the big knuckle, on the back of the hand
  }
  mat = 0.0;
  float nd = 1e5;
  for (int f = 0; f < 5; f++) nd = min(nd, nailField(p, f));
  if (nd < d + 0.012) mat = 1.0;
  d = smin(d, nd, 0.015);
  if (uSleeve > 0.5) {
    vec3 ad = normalize(uElbow - uWrist); float along = dot(p - uWrist, ad);
    float sl = max(sdCone(aq, uWrist, uElbow, 1.55, 2.15) / 1.5, 6.4 - along);
    sl = max(sl, along - 40.0);
    if (sl < d) mat = 2.0;
    d = min(d, sl);
  }
  return d;
}
float map(vec3 p) { float m; return mapM(p, m); }
vec3 normalAt(vec3 p) {
  const vec2 e = vec2(0.008, -0.008);
  return normalize(e.xyy * map(p + e.xyy) + e.yyx * map(p + e.yyx) + e.yxy * map(p + e.yxy) + e.xxx * map(p + e.xxx));
}
void main() {
  vec3 ro = cameraPosition, rd = normalize(vW - cameraPosition);
  float t = max(0.0, distance(cameraPosition, vW) - 0.05), hit = -1.0;
  for (int i = 0; i < 140; i++) {
    float d = map(ro + rd * t);
    if (d < 0.003) { hit = t; break; }
    t += d * 0.8;
    if (d > 60.0) break;
  }
  if (hit < 0.0) discard;
  vec3 p = ro + rd * hit; float mat; mapM(p, mat);
  vec3 n = normalAt(p), v = -rd, L = normalize(uLight);
  float ndl = dot(n, L), fr = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  // ambient occlusion: how close the surface is around, a few steps out along the normal
  float ao = 0.0; for (int i = 1; i <= 4; i++) { float s = 0.12 * float(i); ao += (s - map(p + n * s)) / s; } ao = clamp(1.0 - 0.32 * ao, 0.25, 1.0);
  float hot = 0.0; for (int i = 0; i < 5; i++) { vec3 q = p - uHot[i].xyz; hot += uHot[i].w * exp(-dot(q, q) / 1.1); }
  vec3 hv = normalize(L + v);
  vec3 col; float alpha = 1.0;
  if (uLook < 0.5 || uLook > 1.5) {
    bool skin = uLook < 0.5;
    vec3 alb = skin ? uSkin : vec3(0.66, 0.65, 0.63);
    float rough = skin ? 22.0 : 70.0;
    // warmer, redder over the knuckles and fingertips
    if (skin) { float kn = 0.0; for (int f = 0; f < 5; f++) { kn += exp(-dot(p - uA[f * 3].xyz, p - uA[f * 3].xyz) / 0.25) + 0.7 * exp(-dot(p - uB[f * 3].xyz, p - uB[f * 3].xyz) / 0.12); } alb = mix(alb, alb * vec3(1.06, 0.82, 0.78), clamp(kn, 0.0, 1.0) * 0.55); }
    float spec = pow(max(dot(n, hv), 0.0), rough) * (skin ? 0.22 : 0.5);
    if (mat > 0.5 && mat < 1.5) { alb = skin ? uSkin * vec3(1.02, 0.9, 0.9) + vec3(0.06, 0.04, 0.05) : alb * 1.02; spec = pow(max(dot(n, hv), 0.0), 80.0) * 0.35; }
    if (mat > 1.5) { alb = vec3(0.045, 0.045, 0.055); spec = pow(max(dot(n, hv), 0.0), 8.0) * 0.08; }
    float wrap = clamp((ndl + 0.45) / 1.45, 0.0, 1.0);
    vec3 sss = skin && mat < 0.5 ? vec3(0.55, 0.14, 0.07) * (1.0 - wrap) * 0.35 : vec3(0.0);
    vec3 sky = mix(vec3(0.22, 0.2, 0.24), vec3(0.55, 0.55, 0.62), 0.5 + 0.5 * n.y);
    // a fine skin texture: pores and creases change the sheen, not the shape
    float grain = fract(sin(dot(floor(p * 40.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    spec *= mix(0.7, 1.15, grain);
    spec *= smoothstep(0.0, 0.3, dot(n, v));
    col = alb * (sky * 0.42 * ao + vec3(1.0, 0.95, 0.88) * 1.2 * wrap * mix(0.5, 1.0, ao)) + sss * alb + vec3(1.0) * spec * ao;
    col += uHotCol * hot * alb * 1.6 + fr * (skin ? 0.05 : 0.22) * sky;
  } else {
    // clear glass
    float th = 0.0; { float tt = 0.08; for (int i = 0; i < 10; i++) { float d = map(p + rd * tt); if (d > 0.0) break; th = tt; tt += max(-d, 0.06); } }
    float spec = pow(max(dot(n, hv), 0.0), 60.0) * 1.4;
    float outer = pow(fr, 3.0);
    vec3 edge = mix(vec3(0.16, 0.19, 0.25), vec3(0.95, 0.97, 1.0), outer);
    col = vec3(0.72, 0.78, 0.86) * (0.12 + 0.25 * th) + edge * fr * 1.1 + vec3(1.0) * spec + uHotCol * hot * (1.4 + 1.5 * fr);
    alpha = clamp(0.12 + 0.12 * th + 0.85 * fr + spec * 0.7 + hot * 0.45, 0.0, 1.0);
    alpha *= smoothstep(uFade.y, uFade.x, dot(p - uWrist, normalize(uElbow - uWrist)));
  }
  vec4 clip = projectionMatrix * viewMatrix * vec4(p, 1.0);
  gl_FragDepth = clip.z / clip.w * 0.5 + 0.5;
  outColor = vec4(col, alpha);
}`;

export function handMeshes(scene, opts = {}) {
  const v4 = (n) => Array.from({ length: n }, () => new THREE.Vector4(0, -50, 0, 0.01));
  const look = () => { const i = HAND_LOOKS.findIndex((l) => l.id === opts.look); return i < 0 ? 0 : i; };
  const make = () => {
    const u = { uA: { value: v4(NF) }, uB: { value: v4(NF) }, uNail: { value: v4(5) }, uNailD: { value: v4(5) }, uNailU: { value: v4(5) },
      uToHand: { value: new THREE.Matrix4() }, uWrist: { value: V(0, -50, 0) }, uElbow: { value: V(0, -50, 1) },
      uLight: { value: V(-0.35, 0.85, 0.4).normalize() }, uHotCol: { value: new THREE.Color(opts.glow || '#ffa040') }, uSkin: { value: new THREE.Color(opts.skin || '#c99580') },
      uHot: { value: v4(5) }, uLook: { value: look() }, uSleeve: { value: look() === 1 ? 0 : 1 }, uFade: { value: new THREE.Vector2(2, 6.5) } };
    const glass = look() === 1;
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.ShaderMaterial({ uniforms: u, vertexShader: HAND_VERT, fragmentShader: HAND_FRAG, transparent: glass, depthWrite: !glass, glslVersion: THREE.GLSL3 }));
    m.frustumCulled = false; m.renderOrder = glass ? 6 : 2; scene.add(m);
    return { m, u };
  };
  const meshes = [make(), make()];
  const tmp = V(0, 0, 0);
  function update(poses) {
    poses.forEach((P, h) => {
      const { m, u } = meshes[h];
      const J = P.joints;
      for (let f = 0; f < 5; f++) {
        const j = J[f], r = RAD[f];
        for (let s = 0; s < 3; s++) { u.uA.value[f * 3 + s].set(j[s].x, j[s].y, j[s].z, r[s]); u.uB.value[f * 3 + s].set(j[s + 1].x, j[s + 1].y, j[s + 1].z, r[s + 1]); }
        // the nail: on top of the last bone, near its end
        const d = tmp.copy(j[3]).sub(j[2]).normalize();
        const up = V(0, 1, 0).addScaledVector(d, -d.y).normalize();
        const w = f === 0 ? 1.25 : f === 4 ? 0.8 : 1.0;
        const c = j[3].clone().addScaledVector(d, -0.3 * w).addScaledVector(up, r[3] * 0.82);
        u.uNail.value[f].set(c.x, c.y, c.z, w); u.uNailD.value[f].set(d.x, d.y, d.z, 0); u.uNailU.value[f].set(up.x, up.y, up.z, 0);
        const tip = j[3]; u.uHot.value[f].set(tip.x, tip.y, tip.z, P.heat[f]);
      }
      u.uToHand.value.copy(P.toHand);
      u.uWrist.value.copy(P.wrist); u.uElbow.value.copy(P.elbow);
      // the box the hand is drawn in (the forearm is cut at the bottom of the box, out of the picture)
      const box = new THREE.Box3();
      for (const j of J) for (const q of j) box.expandByPoint(q);
      box.expandByPoint(P.wrist); box.expandByPoint(P.O); box.expandByPoint(P.wrist.clone().lerp(P.elbow, 0.9));
      box.expandByScalar(2.4);
      box.getCenter(m.position); box.getSize(m.scale);
    });
  }
  return { update, meshes, setLook(id) { opts.look = id; meshes.forEach(({ m, u }) => { u.uLook.value = look(); const glass = look() === 1; u.uSleeve.value = glass ? 0 : 1; m.material.transparent = glass; m.material.depthWrite = !glass; m.renderOrder = glass ? 6 : 2; m.material.needsUpdate = true; }); } };
}
