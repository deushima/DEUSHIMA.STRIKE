# Online hit registration repair — 2026-10-26

The host reconstructed stationary shots using Player.moveSpeed (the movement limit), instead of actual velocity. Guest fire cadence was also judged by packet arrival time, so network jitter could reject valid rounds and desynchronize the rest of the spray. Hits were checked against current geometry even when the guest saw an earlier interpolated pose. Predicted hitmarkers could imply damage that the host never confirmed.

## Changes

- Send the scheduled simulation fire time and motion/stance at fire time; reconstruct recoil and seeded dispersion using those same inputs on the host. Keep full precision for the aim ray.
- Validate cadence, bounded clock lead, ownership, ammo, sequence, round and life. Legacy packets retain the receipt-time fallback.
- Capture actual skinned hit geometry at up to 30 Hz. Guest shots can rewind to host-issued rendered pose times, limited by measured RTT plus 100 ms, with a hard 400 ms cap. Interpolate nearby poses; restore mesh, skeleton and skin-bind matrices synchronously. Do not enlarge hitboxes. World occlusion and team rules still apply.
- Clear history and shot clocks between lives/rounds. Preserve the first valid shot after a guest reload even if its completion state arrives before the host receipt-time deadline.
- Show online hitmarkers only on authoritative damage confirmation, including shots fired by the host. Keep the existing recoil, damage balance and disabled fall damage.

## Validation

- Full `npm test` passed, including actual animated CT/T GLB hit geometry, map/navigation/movement tests, online authority, 1v1/2v2/FFA and no-fall-damage regressions.
- New `online-shot-registration.test.mjs`: 36 real WeaponSystem sprays / 1,080 rounds (AK, M4, M249; 30/60/144 FPS; host/guest; moving/still). All legitimate rounds accepted with variable 20–100 ms transit delays. Maximum client/host direction difference 9.2e-16. Includes duplicate/cadence/future/stale-life checks, reload timing, historical animated/translated rigs, matrix restoration, walls and team rules.
- Two actual local browser clients connected through PeerJS/WebRTC on AIM_MAP. Guest AK: 4 chest hits killed host (first hit 100 to 73 HP). Host M4: 5 chest hits killed guest. Rounds advanced and score became 1:1.
- Live delayed-shot experiment: guest packet delayed 120 ms, target moved one metre sideways 60 ms after firing. Historical chest hit registered for 27 damage despite the target's new position. No hit geometry was enlarged or damage injected.
- Browser automation reported pointer-lock WrongDocumentError in the embedded background tabs during match start; gameplay/network/combat continued. This test used controlled aim/fire fixtures, not a human pointer-lock playtest or two geographically separated networks.
- `npm run build:static` passed. Reload both clients and create a new room after deployment to use the same protocol revision.

This is bounded lag compensation for the existing P2P game, not a claim of full Source 2 networking parity. Remote motion is still client-reported under the existing host-authority model. Extreme latency beyond the rewind cap is not compensated completely.
