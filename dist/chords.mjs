const qualities={ '':'major',m:'minor',mi:'minor','-':'minor','7':'dominant',maj7:'major-seventh',M7:'major-seventh','Δ7':'major-seventh',m7:'minor-seventh',mi7:'minor-seventh','-7':'minor-seventh',m7b5:'half-diminished','-7b5':'half-diminished',dim:'diminished',dim7:'diminished-seventh',aug:'augmented','+':'augmented',sus:'suspended-fourth',sus4:'suspended-fourth',sus2:'suspended-second','6':'major-sixth',m6:'minor-sixth','9':'dominant-ninth',maj9:'major-ninth','Δ9':'major-ninth',m9:'minor-ninth','11':'dominant-11th',m11:'minor-11th','13':'dominant-13th',maj13:'major-13th'};
export const chordKinds=[...new Set(Object.values(qualities))];
export function parseChord(text){const m=text.replaceAll('♭','b').replaceAll('♯','#').trim().match(/^([A-G])([#b]?)([^/]*)(?:\/([A-G])([#b]?))?$/);if(!m||!(m[3] in qualities))throw Error('Use a chord such as Abmaj7, Cm7, Dm7b5, G7, or C/E. Use the full MusicXML editor for other extensions.');return {step:m[1],alter:m[2]==='#'?1:m[2]==='b'?-1:0,kind:qualities[m[3]],bass:m[4]?{step:m[4],alter:m[5]==='#'?1:m[5]==='b'?-1:0}:null};}
export function addHarmony(doc,measure,text,beat,divisions){
 const chord=parseChord(text);if(!Number.isFinite(beat)||beat<1||beat>32)throw Error('Chord beat must be between 1 and 32.');
 const create=(name,value)=>{const e=doc.createElement(name);if(value!==undefined)e.textContent=String(value);return e;};
 const harmony=create('harmony'),root=create('root');root.appendChild(create('root-step',chord.step));if(chord.alter)root.appendChild(create('root-alter',chord.alter));harmony.appendChild(root);harmony.appendChild(create('kind',chord.kind));
 if(chord.bass){const bass=create('bass');bass.appendChild(create('bass-step',chord.bass.step));if(chord.bass.alter)bass.appendChild(create('bass-alter',chord.bass.alter));harmony.appendChild(bass);}
 if(beat!==1)harmony.appendChild(create('offset',Math.round((beat-1)*divisions)));
 const firstNote=measure.getElementsByTagName('note')[0];measure.insertBefore(harmony,firstNote||null);return harmony;
}
