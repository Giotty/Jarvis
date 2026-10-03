import { memo, CSSProperties } from 'react';
const ticks = Array.from({ length: 120 }, (_, i) => ({ angle: i * 3, long: i % 10 === 0 }));
export const Reactor = memo(function Reactor({ state, level }: { state: string; level: number }) {
  return (
    <div
      className={'reactor state-' + state.toLowerCase().replaceAll(' ', '-')}
      style={{ '--energy': Math.min(1, level) } as CSSProperties}
      role="img"
      aria-label={'JARVIS reactor · ' + state}
    >
      <svg className="reactor-foundation" viewBox="0 0 600 600" aria-hidden="true">
        <defs>
          <radialGradient id="reactor-well">
            <stop stopColor="#073a51" />
            <stop offset="1" stopColor="#01090f" />
          </radialGradient>
          <linearGradient id="reactor-energy" x2="0.5" y2="1">
            <stop stopColor="#fff" />
            <stop offset=".45" stopColor="#a4f8ff" />
            <stop offset="1" stopColor="#19bce9" />
          </linearGradient>
          <filter id="reactor-glow" x="-35%" y="-35%" width="170%" height="170%">
            <feGaussianBlur stdDeviation="3" />
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle cx="300" cy="300" r="242" fill="url(#reactor-well)" stroke="#174053" />
        <path
          className="crosshair"
          d="M0 300H126M474 300H600M300 0V126M300 474V600M104 104L139 139M461 461L496 496M104 496L139 461M461 139L496 104"
        />
        <circle className="faint" cx="300" cy="300" r="294" />
        <circle className="faint" cx="300" cy="300" r="257" />
        <g className="radial-ticks">
          {ticks.map(({ angle, long }) => (
            <path
              key={angle}
              d={'M300 16V' + (long ? 35 : 24)}
              transform={'rotate(' + angle + ' 300 300)'}
              className={long ? 'major' : 'minor'}
            />
          ))}
        </g>
        <g className="mechanical-layer">
          {Array.from({ length: 18 }, (_, i) => (
            <path
              key={i}
              d="M290 65H310L316 88H284Z"
              transform={'rotate(' + i * 20 + ' 300 300)'}
            />
          ))}
        </g>
        <circle cx="300" cy="300" r="198" className="faint" />
        <circle cx="300" cy="300" r="188" className="faint" />
        <path
          className="structural"
          d="M198 209L173 256V354L225 401H374L426 355V255L401 208M203 402L223 426H376L398 402"
        />
      </svg>
      <svg className="rotor rotor-a" viewBox="0 0 600 600" aria-hidden="true">
        <circle
          cx="300"
          cy="300"
          r="267"
          pathLength="100"
          strokeDasharray="18 3 7 8 23 4 13 5 6 13"
        />
        <circle cx="300" cy="300" r="238" pathLength="100" strokeDasharray="1 2" />
      </svg>
      <svg className="rotor rotor-b" viewBox="0 0 600 600" aria-hidden="true">
        <circle
          cx="300"
          cy="300"
          r="216"
          pathLength="100"
          strokeDasharray="19 4 2 2 18 8 24 6 9 8"
        />
        <path d="M297 77L300 69L303 77M77 297L69 300L77 303" />
      </svg>
      <svg className="rotor rotor-c" viewBox="0 0 600 600" aria-hidden="true">
        <circle cx="300" cy="300" r="171" pathLength="100" strokeDasharray="24 9 8 4 18 11 16 10" />
        <circle cx="300" cy="300" r="154" pathLength="100" strokeDasharray=".2 1.5" />
      </svg>
      <svg className="energy-form" viewBox="0 0 600 600" aria-hidden="true">
        <path className="energy-outline" d="M300 179L425 395H175Z" />
        <path
          className="energy-triangle"
          d="M300 205L407 387H193Z"
          fill="url(#reactor-energy)"
          filter="url(#reactor-glow)"
        />
        <path className="energy-inset" d="M300 254L352 347H248Z" />
        <path className="energy-vents" d="M300 173V144M176 396L151 413M425 396L450 413" />
      </svg>
      <div className="reactor-caption">
        <b>J.A.R.V.I.S.</b>
        <span>{state}</span>
      </div>
      <span className="reactor-coordinate coord-n">MI / NEURAL SYSTEMS</span>
      <span className="reactor-coordinate coord-s">INTELLIGENCE · CONTROL · PERCEPTION</span>
      <span className="reactor-coordinate coord-w">
        CORE
        <br />
        01
      </span>
      <span className="reactor-coordinate coord-e">
        HOST
        <br />
        LINK
      </span>
    </div>
  );
});
