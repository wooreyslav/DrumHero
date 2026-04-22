// ── MIDI Parser ───────────────────────────────────────────────────────────────
// Returns { notes, bpm, ticksPerBeat, tempoMap }
// notes: [{ time (seconds), note, vel }]

export async function parseMidi(arrayBuffer) {
  const data = new DataView(arrayBuffer);
  let pos = 0;

  const read = n => {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 8) | data.getUint8(pos++);
    return v;
  };

  const readVLQ = () => {
    let v = 0, b;
    do { b = data.getUint8(pos++); v = (v << 7) | (b & 0x7f); } while (b & 0x80);
    return v;
  };

  if (read(4) !== 0x4d546864) throw new Error('Not a MIDI file');
  read(4); // header length (always 6)
  const format       = read(2);
  const numTracks    = read(2);
  const ticksPerBeat = read(2);

  // tempoMap: sorted list of { tick, tempo (µs per beat) }
  const tempoMap = [{ tick: 0, tempo: 500000 }]; // default 120 BPM
  const rawNotes = [];

  for (let t = 0; t < numTracks; t++) {
    const magic    = read(4);
    const trackLen = read(4);
    if (magic !== 0x4d54726b) { pos += trackLen; continue; } // skip non-track chunks

    const trackEnd = pos + trackLen;
    let tick = 0, lastStatus = 0;

    while (pos < trackEnd) {
      tick += readVLQ(); // delta time

      let status = data.getUint8(pos);
      if (status & 0x80) { lastStatus = status; pos++; }
      else               { status = lastStatus; } // running status

      const type = (status >> 4) & 0xf;

      if (status === 0xff) {
        // Meta event
        const metaType = data.getUint8(pos++);
        const metaLen  = readVLQ();
        if (metaType === 0x51 && metaLen === 3) {
          // Tempo change
          const us = (data.getUint8(pos) << 16)
                   | (data.getUint8(pos + 1) << 8)
                   |  data.getUint8(pos + 2);
          // Only add if different tick or different value
          const last = tempoMap[tempoMap.length - 1];
          if (last.tick !== tick || last.tempo !== us) {
            tempoMap.push({ tick, tempo: us });
          }
        }
        pos += metaLen;

      } else if (status === 0xf0 || status === 0xf7) {
        pos += readVLQ(); // sysex

      } else if (type === 0x9) {
        // Note On
        const note = data.getUint8(pos++);
        const vel  = data.getUint8(pos++);
        if (vel > 0) rawNotes.push({ tick, note, vel });

      } else if (type === 0x8) { pos += 2; }  // Note Off
      else if (type === 0xa)   { pos += 2; }  // Aftertouch
      else if (type === 0xb)   { pos += 2; }  // CC
      else if (type === 0xe)   { pos += 2; }  // Pitch bend
      else if (type === 0xc)   { pos += 1; }  // Program change
      else if (type === 0xd)   { pos += 1; }  // Channel pressure
      else                     { pos++; }
    }
    pos = trackEnd;
  }

  // Sort tempo map by tick ascending
  tempoMap.sort((a, b) => a.tick - b.tick);

  // ── Tick → seconds ──────────────────────────────────────────────────────────
  // Walk through tempo segments; each segment uses the tempo active at its start.
  function ticksToSec(targetTick) {
    let sec = 0;
    for (let i = 0; i < tempoMap.length; i++) {
      const segStart = tempoMap[i].tick;
      const segEnd   = i + 1 < tempoMap.length ? tempoMap[i + 1].tick : Infinity;
      const tempo    = tempoMap[i].tempo;

      if (targetTick <= segStart) break;

      const ticksInSeg = Math.min(targetTick, segEnd) - segStart;
      sec += (ticksInSeg / ticksPerBeat) * (tempo / 1e6);

      if (targetTick <= segEnd) break;
    }
    return sec;
  }

  const notes = rawNotes.map(n => ({
    time: ticksToSec(n.tick),
    note: n.note,
    vel:  n.vel,
  }));
  notes.sort((a, b) => a.time - b.time);

  // BPM from the first explicit tempo event (or default 120)
  const mainTempo = tempoMap.length > 1 ? tempoMap[1].tempo : 500000;
  const bpm = Math.round(60000000 / mainTempo);

  return { notes, bpm, ticksPerBeat, tempoMap };
}
