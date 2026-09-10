"""Visual transcription of the user's two-page scan, authored measure by measure.

No OCR output is consumed. Durations are in sixteenth-note units (16 per bar).
Source systems: 1-24 on page 1; 25-51 on page 2.
"""
from pathlib import Path
import copy, json, re
import xml.etree.ElementTree as E

OUT=Path('output'); OUT.mkdir(exist_ok=True)
M=[]
def bar(notes, chords=(), **kw):
    result={'number':len(M)+1,'notes':[], 'chords':list(chords), **kw}
    for item in notes.split():
        pitch,duration,*flags=item.split(':')
        result['notes'].append({'p':pitch,'d':int(duration),'tie':flags[0] if flags else ''})
    assert sum(n['d'] for n in result['notes'])==16,(result['number'],notes,sum(n['d'] for n in result['notes']))
    M.append(result);return result
def h(symbol, beat=1, conditional=False):return {'symbol':symbol,'at':round((beat-1)*4),'conditional':conditional}
def lyrics(b,*verses):
    for verse in verses:
        vals=verse.split('|');assert len(vals)==len(b['notes']),(b['number'],len(vals),len(b['notes']));b.setdefault('lyrics',[]).append(vals)
    return b
SLASH='x:4 x:4 x:4 x:4'
VERSE='C5:4 C5:3 Eb5:1:> Eb5:2:< C5:1 Bb4:1 C5:4:>'
REST='C5:4:< r:4 r:8'
VB=[[1,2],[3,4,5]]

# Page 1, system 1: repeated four-bar rhythm intro.
bar(SLASH,[h('Abmaj9')],section='Intro',forward=True,tempo=104,words='Kinda like “What’s Going On”',key=-4)
bar(SLASH,[h('Bbm7')]);bar(SLASH,[h('Cm7')]);bar(SLASH,[h('Dm'),h('Dm/G',3)],backward=True)

# A: both printed lyric verses.
lyrics(bar(VERSE,[h('Abmaj9')],section='A',forward=True,beams=VB,slurs=[(4,5)]),'Look-|ing|in||your||eyes','Look-|ing|at||your||hands')
bar(REST,[h('Bbm7')])
lyrics(bar(VERSE,[h('Cm7')],beams=VB,slurs=[(4,5)]),'Kind|of|hea-||ven||eyes','Hands|can|un-||der-||stand')
bar(REST,[h('Dm'),h('Dm/G',3)])
lyrics(bar(VERSE,[h('Abmaj9')],beams=VB,slurs=[(4,5)]),'Clos-|ing|both||my||eyes','Wait-|ing|for||the||chance')
bar(REST,[h('Bbm7')])
lyrics(bar(VERSE,[h('Cm7')],beams=VB,slurs=[(4,5)]),'Wait-|ing|for||sur-||prise','Just|to|hold||your||hand')
lyrics(bar('C5:4:< r:4 r:2 G4:2 C5:1 D5:2 Eb5:1:>',[h('Dm7'),h('Dm/G',3)],beams=[[4,5,6]]),'|||To|see|the|heav-','|||A|touch|of|rain-')

# B: the key signature remains four flats; the printed naturals/flats are explicit.
lyrics(bar('Eb5:4:< Eb5:3 F5:1:> F5:1:< Eb5:2 C5:1:> C5:2:< C5:1 D5:1:>',[h('Ab')],section='B',segno=True,beams=[[1,2],[3,4,5],[6,7,8]]),'|en|in||your|eyes||is|not','|And|sun-||shine|made||the|flow-')
lyrics(bar('D5:2:< Eb5:2 Eb5:1 Eb5:3:> Eb5:4:< r:2 Bb4:2',[h('Ebmaj7')],beams=[[0,1],[2,3]]),'|so||far|||’cos','|er||grow|||in-')
lyrics(bar('Db5:4:> Db5:1:< Db5:2 Eb5:1:> Eb5:1:< Db5:2 Cb5:1 Bb4:2 Bb4:1 Bb4:1:>',[h('Dbm7'),h('Gb13',2.75)],beams=[[1,2,3],[4,5,6],[7,8,9]],slurs=[(6,7)]),'I’m|not|a-|fraid||to|try||and|go','to||a|love-||ly|smile||that’s|')
lyrics(bar('Bb4:1:< Db5:1 Db5:2 r:4 r:2 Gb4:2 Cb5:2 Db5:1 D5:1:>',[h('Bmaj9')],beams=[[0,1,2],[6,7,8]]),'||it|||To|know|the|love','||ing|||And|it’s|so|clear')
lyrics(bar('D5:4:< D5:2:> D5:1:< E5:1:> E5:1:< D5:2 Cb5:2 C5:2 D5:1:>',[h('Bm7')],beams=[[1,2,3],[4,5,6,7,8]]),'|And|the|beau-||ty|nev-|er|known','|To||me||that|here’s|a|dream')
lyrics(bar('D5:2:< D5:2 D5:1 D5:3:> D5:4:< r:2 D5:2:>',[h('E11'),h('E7',3)],beams=[[0,1],[2,3]]),'|be-||fore|||I’ll','|come||true|||There’s')
lyrics(bar('D5:4:< D5:1 D5:2 E5:1:> E5:1:< D5:2 Cb5:1:> Cb5:1:< Cb5:2 D5:1:>',[h('Dm(add9)')],beams=[[1,2,3],[4,5,6],[7,8,9]]),'|leave|it|up||to|you||to|show','|no|way|that||I’ll|be||los-|')
lyrics(bar('D5:2:< D5:2 D5:4 r:4 Gb4:4',[h('G9sus4')],tocoda=True,beams=[[0,1]]),'|it|||And','|ing|||')

# C, first refrain. The first and last pitches of m21 are explicitly G-flat.
lyrics(bar('Gb5:4 F5:1 Gb5:1 F5:2:> F5:1:< Eb5:3 r:3 Gb5:1:>',[h('Cm'),h('G7b13/B',2.5)],section='C',beams=[[1,2,3],[4,5]],slurs=[(1,2)]),'Gold-|en||la-||dy,||Gold-')
lyrics(bar('Gb5:4:< F5:2 Eb5:2:> Eb5:1:< Eb5:3 F5:4',[h('Eb/Bb'),h('Am7b5',2.5)],beams=[[1,2],[3,4]]),'|en|la-||dy,|I’d')
lyrics(bar('F5:2 C5:2:> C5:1:< C5:3 C5:3 Bb4:1 Ab4:2 Bb4:1 C5:1:>',[h('Dbmaj7')],beams=[[0,1],[2,3],[4,5],[6,7,8]]),'Like|to||go|there||||')
bar('C5:8:< r:8')

# Page 2, system 1: second written refrain (rhythmic differences retained).
lyrics(bar('Gb5:4 F5:1 Gb5:1 F5:2 F5:1 Eb5:3 r:2 Gb5:2:>',[h('Cm'),h('G7b13/B',2.5)],beams=[[1,2,3],[4,5]],slurs=[(1,2)]),'Gold-|en||la-||dy,||Gold-')
lyrics(bar('Gb5:4:< F5:2 Eb5:2:> Eb5:1:< Eb5:3 F5:4',[h('Eb/Bb'),h('Am7b5',2.5)],beams=[[1,2],[3,4]]),'|en|la-||dy,|I’d')
lyrics(bar('F5:2 C5:2:> C5:1:< C5:3 C5:3 Bb4:1 Ab4:2 Bb4:1 C5:1:>',[h('Dbmaj7')],beams=[[0,1],[2,3],[4,5],[6,7,8]]),'Like|to||go|there||||')
lyrics(bar('C5:4:< r:4 Eb5:2 C5:2:> C5:1:< Ab4:2 Bb4:1',beams=[[2,3],[4,5,6]]),'||Take|me||right|a-')
lyrics(bar('B4:12 r:4',[h('Cmaj7')]),'way.|')
bar(SLASH,words='Keep groovin’…')
bar(SLASH,[h('Bbm(add9)')])
bar('x:6 x:2:> x:4:< x:4',[h('Eb9sus4')],ending='1',backward=True)

# Second ending, then the written repeatable solo.
bar('x:6 x:2:> x:4:< x:4',[h('Eb9sus4')],ending='2')
bar(SLASH,[h('Abmaj9')],section='D',forward=True,words='Instrumental solo section')
bar(SLASH,[h('Bbm(add9)')]);bar(SLASH,[h('Cm7')])
lyrics(bar('x:4 x:4 r:2 Gb4:2 C5:1 D5:2 Eb5:1:>',[h('Dm'),h('Dm/G',3)],beams=[[4,5,6]],backward=True,ds=True),'|||A|touch|of|rain-')

# Coda arrival: source tie enters from the To Coda jump in m19.
lyrics(bar('D5:2:< D5:2:> D5:4:< r:4 G4:4',[h('G9sus4'),h('Ab9sus4',4)],coda=True,beams=[[0,1]]),'|it|||And','|ing|||')
lyrics(bar('Ab5:4 Gb5:1 Ab5:1 Gb5:2:> Gb5:1:< E5:3 r:2 Ab5:2:>',[h('Dbm'),h('Ab7b13/C',2.5)],forward=True,beams=[[1,2,3],[4,5]],slurs=[(1,2)]),'Gold-|en||la-||dy||Gold-')
lyrics(bar('Ab5:4:< Gb5:2 E5:2:> E5:1:< E5:3 Gb5:4',[h('E/B'),h('Bbm7b5',2.5)],beams=[[1,2],[3,4]]),'|en|la-||dy|I’d')
lyrics(bar('F#5:2 C#5:2:> C#5:1:< C#5:3 C#5:2 B4:2 B4:2 A4:2',[h('Dmaj7')],beams=[[0,1],[2,3],[4,5,6,7]],slur_out=7),'Like|to||go|there|||')
bar('C#5:12 r:4',[h('A9sus4',1,True)],backward=True,slur_in=0)

# E: key signature changes to one flat. Source conditional chord retained.
lyrics(bar('A5:4 G5:1 A5:1 G5:2:> G5:1:< F5:3 r:2 A5:2:>',[h('Dm'),h('A7b13/C#',2.5)],section='E',key=-1,forward=True,beams=[[1,2,3],[4,5]],slurs=[(1,2)]),'Gold-|en||la-||dy||Gold-')
lyrics(bar('A5:4:< G5:2 F5:2:> F5:1:< F5:3 G5:4',[h('F/C'),h('Bm7b5',2.5)],beams=[[1,2],[3,4]]),'|en|la-||dy|I’d')
lyrics(bar('G5:2 D5:2:> D5:1:< D5:3 D5:2 C5:2 C5:2 D5:2:>',[h('Ebmaj7')],beams=[[0,1],[2,3],[4,5,6,7]]),'Like|to||go|there|||')
bar('D5:12:< r:4',[h('Bb9sus4',1,True)],backward=True)

# Final modulation: six flats, then the held E-flat major-seven ending.
lyrics(bar('Bb5:4 Ab5:1 Bb5:1 Ab5:2:> Ab5:1:< Gb5:3 r:2 Bb5:2:>',[h('Ebm'),h('Bb7b13/D',2.5)],key=-6,forward=True,beams=[[1,2,3],[4,5]],slurs=[(1,2)]),'Gold-|en||la-||dy||Gold-')
lyrics(bar('Bb5:4:< Ab5:2 Gb5:2:> Gb5:1:< Gb5:3 Ab5:4',[h('Gb/Db'),h('Cm7b5',2.5)],beams=[[1,2],[3,4]]),'|en|la-||dy|I’d')
lyrics(bar('Ab5:2 Eb5:2:> Eb5:1:< Eb5:3 Eb5:2 Db5:2 Db5:2 Eb5:2:>',[h('Emaj7')],beams=[[0,1],[2,3],[4,5,6,7]]),'Like|to||go|there|||')
lyrics(bar('Eb5:4:< r:4 Gb5:2 Eb5:2:> Eb5:1:< Cb5:2 Db5:1',beams=[[2,3],[4,5,6]],backward=True,words_below='Ritard last time…'),'||Take|me||right|a-')
bar('x:16',[h('Ebmaj7')],final=True,fermata=0)

assert len(M)==51

def sub(parent,tag,value=None,**attrs):
    el=E.SubElement(parent,tag,{k.replace('_','-'):str(v) for k,v in attrs.items()})
    if value is not None:el.text=str(value)
    return el
def pitch_parts(p):
    match=re.fullmatch(r'([A-G])([b#]?)(\d)',p);assert match,p
    return match[1],{'b':-1,'#':1,'':0}[match[2]],int(match[3])
def emit_harmony(parent,item):
    symbol=item['symbol']; root_suffix,*bass=symbol.split('/')
    match=re.match(r'^([A-G])([b#]?)(.*)$',root_suffix);step,acc,suffix=match.groups()
    hm=sub(parent,'harmony');root=sub(hm,'root');sub(root,'root-step',step)
    if acc:sub(root,'root-alter',-1 if acc=='b' else 1)
    lookup={'':'major','m':'minor','m7':'minor-seventh','maj7':'major-seventh','maj9':'major-ninth','7':'dominant','13':'dominant-13th','11':'dominant-11th','m7b5':'half-diminished','7b13':'dominant','m(add9)':'minor','9sus4':'suspended-fourth'}
    kind=sub(hm,'kind',lookup[suffix],text={'m':'−','m7':'−7','maj7':'Δ7','maj9':'Δ9','7':'7','13':'13','11':'11','m7b5':'−7♭5','7b13':'7♭13','m(add9)':'−(add9)','9sus4':'sus9','':''}[suffix])
    if bass:
        match=re.fullmatch(r'([A-G])([b#]?)',bass[0]);b=sub(hm,'bass');sub(b,'bass-step',match[1]);
        if match[2]:sub(b,'bass-alter',-1 if match[2]=='b' else 1)
    degrees=[]
    if suffix=='7b13':degrees=[(13,-1,'add')]
    if suffix=='m(add9)':degrees=[(9,0,'add')]
    if suffix=='9sus4':degrees=[(7,-1,'add'),(9,0,'add')]
    for number,alter,typ in degrees:
        d=sub(hm,'degree',print_object='no');sub(d,'degree-value',number);sub(d,'degree-alter',alter);sub(d,'degree-type',typ)
    if item['at']:sub(hm,'offset',item['at'])
    if item['conditional']:direction(parent,'words','2nd time only',offset=item['at'])
def direction(parent,tag,text='',offset=0,placement='above',**attrs):
    d=sub(parent,'direction',placement=placement);dt=sub(d,'direction-type');el=sub(dt,tag,text or None,**attrs)
    if offset:sub(d,'offset',offset)
    return d

root=E.Element('score-partwise',version='4.0')
sub(sub(root,'work'),'work-title','Golden Lady')
ident=sub(root,'identification');sub(ident,'creator','Stevie Wonder',type='composer')
enc=sub(ident,'encoding');sub(enc,'software','ScoreShift / Atlas visual transcription')
sub(enc,'encoding-description','Complete 51-measure visual transcription from the supplied two-page rhythm chart. Original written repeats, endings, modulations, and conditional chords retained. See transcription notes for source ambiguities. Not an OCR export.')
defaults=sub(root,'defaults');scaling=sub(defaults,'scaling');sub(scaling,'millimeters',7);sub(scaling,'tenths',40)
pl=sub(root,'part-list');sp=sub(pl,'score-part',id='P1');sub(sp,'part-name','Melody');sub(sp,'part-abbreviation','')
part=sub(root,'part',id='P1')
system_starts={1,5,9,13,17,21,25,29,33,38,43,47}
types={1:('16th',False),2:('eighth',False),3:('eighth',True),4:('quarter',False),6:('quarter',True),8:('half',False),12:('half',True),16:('whole',False)}
key_map={-4:{'B':-1,'E':-1,'A':-1,'D':-1},-1:{'B':-1},-6:{'B':-1,'E':-1,'A':-1,'D':-1,'G':-1,'C':-1}}
key=-4;previous_lyric={}
for b in M:
    number=b['number'];measure=sub(part,'measure',number=number)
    if number in system_starts and number!=1:sub(measure,'print',new_system='yes',**({'new_page':'yes'} if number==25 else {}))
    if 'key' in b or number==1:
        attrs=sub(measure,'attributes')
        if number==1:sub(attrs,'divisions',4)
        key=b.get('key',key);k=sub(attrs,'key');sub(k,'fifths',key)
        if number==1:
            time=sub(attrs,'time');sub(time,'beats',4);sub(time,'beat-type',4)
            clef=sub(attrs,'clef');sub(clef,'sign','G');sub(clef,'line',2)
    if b.get('section'):direction(measure,'rehearsal',b['section'])
    if b.get('segno'):direction(measure,'segno')
    if b.get('coda'):direction(measure,'coda')
    if b.get('tocoda'):direction(measure,'words','To Coda');direction(measure,'coda')
    if b.get('words'):direction(measure,'words',b['words'])
    if b.get('words_below'):direction(measure,'words',b['words_below'],placement='below')
    if b.get('tempo'):
        d=sub(measure,'direction',placement='above');metro=sub(sub(d,'direction-type'),'metronome');sub(metro,'beat-unit','quarter');sub(metro,'per-minute',b['tempo']);sub(d,'sound',tempo=b['tempo'])
    if b.get('forward') or b.get('ending'):
        bl=sub(measure,'barline',location='left')
        if b.get('ending'):sub(bl,'ending',number=b['ending'],type='start')
        if b.get('forward'):sub(bl,'repeat',direction='forward')
    for item in b['chords']:emit_harmony(measure,item)
    accidental_state={};beam_map={}
    stem_map={}
    for group in b.get('beams',[]):
        pitched=[pitch_parts(b['notes'][i]['p']) for i in group if b['notes'][i]['p'] not in ('r','x')]
        group_stem='down' if sum(o*7+'CDEFGAB'.index(s) for s,a,o in pitched)/len(pitched)>=34 else 'up'
        for i in group:stem_map[i]=group_stem
        for pos,i in enumerate(group):
            beam_map.setdefault(i,[]).append((1,'begin' if pos==0 else 'end' if pos==len(group)-1 else 'continue'))
            if b['notes'][i]['d']==1:
                prev=pos>0 and b['notes'][group[pos-1]]['d']==1;nxt=pos+1<len(group) and b['notes'][group[pos+1]]['d']==1
                beam_map[i].append((2,'continue' if prev and nxt else 'end' if prev else 'begin' if nxt else 'backward hook' if pos else 'forward hook'))
    slur_map={}
    for sn,(a,z) in enumerate(b.get('slurs',[]),1):slur_map.setdefault(a,[]).append((sn,'start'));slur_map.setdefault(z,[]).append((sn,'stop'))
    if 'slur_out' in b:slur_map.setdefault(b['slur_out'],[]).append((6,'start'))
    if 'slur_in' in b:slur_map.setdefault(b['slur_in'],[]).append((6,'stop'))
    for i,n in enumerate(b['notes']):
        el=sub(measure,'note');p=n['p'];duration=n['d'];typ,dot=types[duration]
        if p=='r':sub(el,'rest')
        elif p=='x':un=sub(el,'unpitched');sub(un,'display-step','B');sub(un,'display-octave',4)
        else:
            step,alter,octave=pitch_parts(p);pit=sub(el,'pitch');sub(pit,'step',step)
            if alter:sub(pit,'alter',alter)
            sub(pit,'octave',octave)
        sub(el,'duration',duration)
        if '<' in n['tie']:sub(el,'tie',type='stop')
        if '>' in n['tie']:sub(el,'tie',type='start')
        sub(el,'type',typ)
        if dot:sub(el,'dot')
        if p not in ('r','x'):
            previous=accidental_state.get((step,octave),key_map[key].get(step,0))
            if alter!=previous and '<' not in n['tie']:sub(el,'accidental',{-1:'flat',0:'natural',1:'sharp'}[alter])
            accidental_state[(step,octave)]=alter
            sub(el,'stem',stem_map.get(i,'up' if step in 'ABG' and octave==4 else 'down'))
        if p=='x':
            sub(el,'stem','none' if duration==4 or duration==16 else 'up');sub(el,'notehead','slash')
        for beamnum,beamtype in beam_map.get(i,[]):sub(el,'beam',beamtype,number=beamnum)
        if n['tie'] or i in slur_map or b.get('fermata')==i:
            no=sub(el,'notations')
            if (number==37 and i==6) or (number==38 and i==0):
                # A visual tie fragment at a repeat/coda jump, per MusicXML 4.0.
                sub(no,'tied',type='start');sub(no,'tied',type='stop')
            else:
                if '<' in n['tie']:sub(no,'tied',type='stop')
                if '>' in n['tie']:sub(no,'tied',type='start')
            for sn,st in slur_map.get(i,[]):sub(no,'slur',type=st,number=sn)
            if b.get('fermata')==i:sub(no,'fermata',type='upright')
        for vi,verse in enumerate(b.get('lyrics',[]),1):
            text=verse[i]
            if not text:continue
            ly=sub(el,'lyric',number=vi);previous_text=previous_lyric.get(vi,'')
            previous_lyric[vi]=text
            start=text.endswith('-');continuation=previous_text.endswith('-')
            sub(ly,'syllabic','middle' if start and continuation else 'begin' if start else 'end' if continuation else 'single')
            sub(ly,'text',text.rstrip('-'))
    if b.get('ds'):direction(measure,'words','D.S. al Coda')
    if b.get('backward') or b.get('ending') or b.get('final'):
        bl=sub(measure,'barline',location='right')
        if b.get('ending'):sub(bl,'ending',number=b['ending'],type='stop' if b.get('backward') else 'discontinue')
        if b.get('backward'):sub(bl,'repeat',direction='backward')
        elif b.get('final'):sub(bl,'bar-style','light-heavy')

E.indent(root)
xml=E.tostring(root,encoding='utf-8',xml_declaration=True)
(OUT/'golden-lady-full.musicxml').write_bytes(xml)
(OUT/'golden-lady-transcription-data.json').write_text(json.dumps(M,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'measures':len(M),'pitched_notes':len(root.findall('.//pitch')),'rhythm_slashes':len(root.findall('.//unpitched')),'chords':len(root.findall('.//harmony')),'lyric_syllables':len(root.findall('.//lyric')),'key_signatures':[e.text for e in root.findall('.//key/fifths')]},indent=2))
