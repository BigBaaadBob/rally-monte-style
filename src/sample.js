// Invented sample rally ("Desert Loop") for testing and demo. Not taken from any real event.
// Same shape as a typical page: a restart in row 2, several checkpoints, free zones, and close-together RIs.
const SAMPLE_ROWS = [
  { ri: 41, om: 8.42, czt: null, cp: null, instr: '"CATTLE GUARD".', info: '(caution, rough.)' },
  { ri: 42, om: '8.55/0.00', czt: '09:12:00', cp: 21, instr: 'RESTART at "Quail Rd". EFZ.', info: '(street sign.) (CP 21.)' },
  { ri: 43, om: 0.62, czt: null, cp: null, instr: 'R second OPP.', info: '(dirt.)' },
  { ri: 44, om: 1.90, czt: '09:14:30', cp: 22, instr: 'CHECKPOINT at [curve-right sign, 35 MPH].', info: '(CP 22.)' },
  { ri: 45, om: 2.21, czt: '09:15:15', cp: 23, instr: 'CHECKPOINT at [curve-left sign, 25 MPH].', info: '(CP 23.)' },
  { ri: 46, om: 3.05, czt: '09:16:45', cp: 24, instr: 'CHECKPOINT at [dip sign].', info: '(CP 24.)' },
  { ri: 47, om: 3.88, czt: '09:18:00', cp: 25, instr: 'CHECKPOINT at [stop-ahead sign].', info: '(CP 25.)' },
  { ri: 48, om: 4.03, czt: null, cp: null, instr: 'STOP. (Then L.)', info: '' },
  { ri: 49, om: 4.55, czt: null, cp: null, instr: 'R at STOP. XT!', info: '(mesa.)' },
  { ri: 50, om: 5.31, czt: '09:20:30', cp: 26, instr: 'CHECKPOINT at "Speed Limit 45". BFZ.', info: '(CP 26.)' },
  { ri: 51, om: 6.40, czt: null, cp: null, instr: 'L at STOP.', info: '(juniper.)' },
  { ri: 52, om: 6.71, czt: null, cp: null, instr: 'EFZ at second "35 MPH".', info: '' },
  { ri: 53, om: 6.95, czt: '09:22:15', cp: 27, instr: 'CHECKPOINT at "Speed Limit 40".', info: '(CP 27.)' },
  { ri: 54, om: 7.38, czt: '09:23:00', cp: 28, instr: 'CHECKPOINT at [narrow-bridge sign].', info: '(CP 28.)' },
  { ri: 55, om: 7.44, czt: null, cp: null, instr: '"CATTLE GUARD". BFZ.', info: '(caution.)' },
  { ri: 56, om: 7.80, czt: null, cp: null, instr: 'L at Y.', info: '(ranch gate.)' },
  { ri: 57, om: 9.95, czt: null, cp: null, instr: '[T-intersection sign] "Coyote Wash Rd".', info: '' },
];
if (typeof module !== 'undefined') module.exports = SAMPLE_ROWS;
