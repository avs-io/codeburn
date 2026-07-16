import { useMemo } from 'react'

import { motionEnabled } from '../lib/motion'

// Hand-authored three-layer flame, retraced from the approved CodeBurn app icon
// (app/build/icon.svg) minus the squircle: coral outer silhouette (left tongue +
// tall right-curling tip + right tongue), a warmer amber mid layer, and a bright
// cream core. Same path data and sampled fills as the icon so the splash, sidebar
// and dock read as one mark. Coordinates share the icon's 1024 space; the viewBox
// frames just the flame.
const CORAL =
  'M507 786C438 788 352 776 300 736C254 700 248 646 264 588C276 532 288 466 306 420C315 398 324 382 332 374C339 368 346 369 350 382C366 424 393 484 418 526C434 474 452 394 466 332C478 280 490 234 500 198C508 178 524 172 542 186C566 206 590 232 608 264C612 314 620 394 640 444C648 466 660 470 668 460C688 428 716 398 740 392C748 389 754 396 754 412C762 452 776 498 787 552C800 622 784 692 728 732C668 778 574 786 507 786Z'
const AMBER =
  'M508 770C446 772 370 760 322 722C282 692 276 642 290 590C300 546 310 498 328 464C338 446 352 446 360 462C376 424 398 372 416 342C430 318 452 314 466 338C478 360 482 398 490 426C502 406 516 386 536 382C558 378 574 396 584 426C598 468 616 514 642 550C664 580 674 630 658 674C634 720 574 770 508 770Z'
const CREAM =
  'M507 772C452 772 402 744 382 694C364 654 368 606 390 570C402 548 412 510 418 474C424 450 438 442 452 450C466 458 472 482 478 504C483 516 494 520 505 517C517 514 524 504 530 488C540 468 556 464 570 476C584 488 590 518 606 550C630 594 632 646 612 686C590 730 552 772 507 772Z'

/**
 * Brand flame mark. Shared between the launch splash (large) and the sidebar
 * (small). `live` gives the mark an all-but-imperceptible idle flicker on its
 * bright core; the flicker phase is randomized once per mount so a row of flames
 * never metronomes. All motion is gated by motionEnabled().
 */
export function FlameMark({ size = 20, live = false }: { size?: number; live?: boolean }) {
  // Random negative delay so the loop starts mid-cycle at a different point each
  // mount. Computed once; only takes effect when the flicker class is present.
  const flickerStyle = useMemo(() => ({ animationDelay: `-${(Math.random() * 4 + 1).toFixed(2)}s` }), [])
  const flicker = live && motionEnabled()

  return (
    <svg className="flamemark" width={size} height={size} viewBox="196 157 650 650" fill="none" aria-hidden="true">
      <path fill="#e86c39" d={CORAL} />
      <path fill="#f7943c" d={AMBER} />
      <path
        className={flicker ? 'fm-flicker' : undefined}
        style={flicker ? flickerStyle : undefined}
        fill="#fecb8b"
        d={CREAM}
      />
    </svg>
  )
}
