# Garak 제품 로드맵

이 문서는 “Finale, Sibelius, MuseScore에서 기본적으로 만들 수 있는 악보를 Garak에서도 만들 수 있게 한다”는 장기 목표를 실제 개발 단위로 보존합니다. 기능이 버튼으로 존재하는 것만으로 완료 처리하지 않습니다. 입력, 편집, 사보, 재생, undo, 총보/파트, 저장, MusicXML까지 의미가 보존돼야 해당 기능이 지원된 것입니다.

## 현재 수직 슬라이스 — 2026-08-24

### 완료

- 의미 기반 Score → Part → Staff → Measure → Voice → Event 모델
- versioned native format과 instrument snapshot
- 정수 tick 음가, 악보 단위 4/4·3/4·6/8 마디 용량 검증, overflow 없는 자동 마디 진행
- written/sounding pitch와 Piccolo, B♭ Clarinet, F Horn, Bass Clarinet, Double Bass, Glockenspiel 변환 테스트
- 48개 이상 악기 catalog와 4개 편성 template
- VexFlow 5 SVG 총보/파트 사보 및 다중 system
- whole/half/quarter/eighth/sixteenth, 한 점, note/rest, sharp/flat/natural
- 동일음 tie model, SVG, MusicXML
- keyboard/pointer 입력, 100단계 undo/redo
- Web Audio playback, part mute/solo
- local autosave/recovery, Garak JSON import/export
- MusicXML 4.0 단방향 export, SMF MIDI export, print/PDF
- 반응형 shell, visible focus, reduced motion, print-only score
- unit, type, lint, server-render 검증

### 의도적으로 제한

- Staff당 편집 Voice 1개
- NoteEvent당 pitch 1개
- 악보 전체에 하나의 박자(4/4·3/4·6/8)와 C major 조표만 적용
- 한 점음표
- grand staff catalog는 있으나 실제 다중 staff 편집 없음
- percussion catalog는 있으나 note map editor 없음
- 기본 oscillator playback이며 전문 orchestral sample이 아님
- MusicXML import/round-trip과 compressed MXL 없음
- 자동 page/system break, collision avoidance, linked-part layout override 없음
- local device 저장만 있으며 account/collaboration 없음

## P0 — 닫힌 알파: 실제 곡을 끝까지 만들 수 있다

전담 2–4명 기준 대략 3–4개월, 1인 개발은 더 길게 잡습니다.

### 음악 코어

- Rational duration/onset, compound meter 세부 모델과 pickup
- 중간 time/key/clef/tempo 변경
- chords, Staff당 4 voices
- double dots, 32nd/64th
- automatic/manual beams
- tuplets와 nested tuplets의 첫 단계
- grace notes
- enharmonic respelling과 diatonic transpose
- range selection, multi-selection
- copy/cut/paste/repeat paste
- move/transpose/duration scale commands
- command-based undo/redo와 selection restoration
- user-configurable shortcut profile
- step-time Web MIDI input

### 기본 기보

- tie/slur curve fitting
- articulation, dynamics, hairpin
- text, tempo text, rehearsal mark
- lyrics 한 절과 chord symbols 기본
- repeat barline, volta, D.C./D.S./Coda
- fermata, breath, ottava, pedal
- horizontal spacing과 기본 collision avoidance
- system/page 자동 나눔 및 수동 break
- A4/Letter, margin, staff size
- self-hosted SMuFL 1.4 Bravura와 font-ready gate
- SVG/PDF/PNG 출력

### 악기·총보·파트

- versioned instrument catalog data package
- localized long/short names, score order, range warnings
- grand staff, organ 3 staff
- staff groups, brace, bracket, sub-bracket
- concert/transposed pitch view
- instrument change/doubling
- basic unpitched percussion map
- linked parts automatic generation
- part-specific page/system breaks
- multimeasure rest와 basic cue note
- 선택 파트 및 전체 파트 일괄 PDF

### 파일·안전성

- native schema validator와 v1→v2 migration
- IndexedDB local-first snapshot + crash recovery
- atomic save와 previous-good recovery copy
- MusicXML 4.0 import/export semantic round-trip
- `.musicxml`, `.xml`, compressed `.mxl`
- MIDI import wizard와 export
- MXL size/file-count/path/depth 제한, XXE off
- unsupported import feature loss report
- 30개 이상 합법적 golden score corpus

### 재생

- tempo map, repeat/volta traversal
- metronome, start position, loop
- part volume/pan/mute/solo mixer
- basic dynamics/articulation timing
- lazy-loaded sample fallback와 polyphony cap
- offline audio export 기초

### 접근성

- score composite keyboard navigation
- current part/staff/measure/beat/voice/event live announcement
- DOM focus와 score selection 분리
- high contrast, 200% zoom, reduced motion
- VoiceOver와 NVDA 수동 시나리오

### P0 합격 기준

- 30개 golden score에서 glyph 잘림 0
- 지원 서브셋 MusicXML 왕복 후 pitch/rhythm/part/meter/key 손실 0
- 미지원 import 요소가 loss report에 100% 표시
- 총보 수정이 linked part에 즉시 반영
- part layout 변경이 총보 음악 데이터를 바꾸지 않음
- 32 staff × 200 measures viewport 입력 p95 80ms 이하
- 새로고침·오프라인·비정상 종료 후 마지막 성공 autosave 복구
- 키보드만으로 생성→8마디→표현기호→파트→재생→PDF 완료

## P1 — 공개 베타: 전문 앙상블과 오케스트라

누적 6–12개월 이상을 예상합니다.

### 고급 기보

- realtime MIDI recording과 quantization
- cross-staff notation
- tremolo, glissando, ornaments
- multiple lyrics verses, melisma
- figured bass, guitar TAB/chord diagrams
- drum-set notation, slash/rhythmic notation
- cue-sized notes, ossia
- custom lines/symbols/noteheads
- house style, text style, score style cascade
- vertical justification와 optical spacing
- user layout overrides

### 오케스트라 워크플로

- divisi/unison
- cue 자동 생성과 동기화
- hide empty staves, tacet
- system object placement
- score subsets
- custom multi-instrument parts
- conductor/recording part combinations
- 기본 condensing/decondensing
- 대형 score instrument filter와 navigator

### 재생·MIDI

- articulation/expression map
- keyswitch, CC automation
- swing, humanization, grace playback
- hairpin interpolation
- SoundFont 또는 라이선스된 sample library
- WAV/FLAC/MP3 export와 stems
- native desktop MIDI/audio bridge 준비

### 협업·상용 운영

- account, cloud sync, ACL
- share link와 view/comment/edit roles
- comments와 resolved state
- Yjs presence/cursors 및 domain conflict repair
- version history, restore, trash/retention
- team/education workspace
- billing, privacy, data export/delete
- observability, crash recovery, license/SBOM pipeline
- PWA offline shell과 persistent storage UI

### P1 합격 기준

- 100개 이상 합법적 MusicXML corpus
- 지원 의미 요소 round-trip 100%
- 80 staff × 1,000 measures에서 viewport 반응 유지
- 전문 사용자 80% 이상이 도움 없이 score→parts→batch PDF 과업 완료
- keyboard/screen-reader 사용자 완료율 별도 측정

## P2 — 상용 프로: 출판·영화·현대음악

누적 12–24개월 이상이며 전문 사보팀과 음악 도메인 QA가 필요합니다.

- 정교한 condensing rule과 manual override
- complex divisi, cue, tacet, multimeasure rest policy
- multiple movements/flows와 책·곡집
- nested tuplets, feathered beams, polymeter, cadenza
- graphic/aleatoric/microtonal/historical notation
- plugin/scripting API와 template/style marketplace
- publishing preflight, font embedding, batch output
- VST3/AU 또는 안전한 외부 instrument host
- video, timecode, hit points, DAW integration
- high-quality offline render와 stems
- Tauri/Electron desktop, signed updates, native file/MIDI/audio
- tablet pen/touch editing과 review-first mobile app
- organization SSO와 managed deployment

### P2 합격 기준

- 전문 사보가 블라인드 평가 자동 layout 평균 4/5 이상
- 출판 corpus에서 잘림·누락·치명적 충돌 0
- 100 staff 이상 대형 score의 실사용 반응성
- score와 수십 part batch generation 후 음악 데이터 불일치 0
- web/desktop native format 완전 호환
- 모든 이전 schema migration corpus 통과

## 계속 기억할 제품 위험

1. “전체 악기”와 “모든 특수 기보”는 별도 범위입니다.
2. 악기 catalog는 번역, 이름, clef, staff count, transposition, range, percussion map, playback preset을 가진 별도 데이터 제품입니다.
3. MusicXML 의미 왕복과 페이지 모양 유사도는 다른 지표입니다.
4. MIDI import는 score import가 아니며 quantization과 notation inference가 필요합니다.
5. 음원 license는 code license와 별도입니다.
6. notation corpus의 저작권과 사용 허가를 기록해야 합니다.
7. canvas/SVG만으로는 screen reader가 음악 의미를 알 수 없으므로 semantic tree가 필요합니다.
8. 모바일은 데스크톱 UI 축소가 아니라 pen/touch/virtual keyboard 흐름을 새로 설계해야 합니다.
9. 자동 사보 안정성이 기능 개수보다 중요합니다.
10. 사용자 문서는 항상 native format과 MusicXML로 빠져나갈 수 있어야 합니다.
