# Garak 상용 아키텍처 결정 기록

기준일: 2026-08-24

## 1. 결론

Garak의 상용 기술 방향은 “독립적인 의미 모델 + 명령 계층 + 교체 가능한 사보/재생/파일 어댑터”입니다.

현재 수직 슬라이스는 React 19, TypeScript, vinext/Vite, VexFlow 5, Web Audio, localStorage를 사용합니다. Sites 배포 구조상 vinext를 사용하지만 음악 코어는 React와 Cloudflare에 의존하지 않습니다. 제품이 커지면 편집기 SPA, 마케팅/계정 웹, 동기화 서버, export worker를 별도 앱으로 나눌 수 있습니다.

현재 구현에는 고유 악기 preset 140개, 30개 concert key와 조옮김 파트 written key projection, 8개 meter와 기본 beam group, 32nd/64th·겹점, 정수 30–300 BPM global tempo, 동적 horizontal spacing, exact-fraction full-measure rest, grand staff와 Organ 3 staff, 선택 스태프 입력, 마디 추가·안전 제거가 포함됩니다. Key/time command는 선택 마디부터 같은 값의 다음 기존 change boundary 직전까지만 변경하고, meter의 1–255 정수 numerator·power-of-two denominator·exact integer-tick capacity, 모든 part·staff·voice overflow와 resulting-score tie 불변식을 변경 전에 검증합니다. Chord mode는 마지막 note event에 pitch를 추가하고 마지막 추가 tone을 제거하며 event·리듬을 유지하고 해당 tone의 tie를 정리합니다. `ppp`–`fff`/None semantic dynamic은 선택 staff 마지막 event에 attach·replace·clear되고 SVG, staff별 지속 playback/MIDI velocity, MusicXML direction export가 같은 값을 읽습니다. `staccato`·`tenuto`·`accent`·`marcato`/None은 선택 staff 마지막 note event의 단일 articulation으로 저장하고, VexFlow·playback/MIDI·MusicXML import/export가 공유합니다. Uncompressed MusicXML import는 같은 8단계 dynamic direction을 지정 staff·선택 primary voice의 다음 표현 가능한 event에 붙여 마디 경계를 넘어 carry하고, 4개 articulation subset을 event value로 바꿉니다. Browser autosave는 검증된 primary와 last-known-good backup을 사용하며 손상 복구 뒤 damaged raw를 보존하려고 명시적 Save now/New까지 autosave를 멈춥니다. Playback plan, MIDI, MusicXML export는 모든 스태프의 schema-v1 단일 voice를 읽고, import는 source time cursor와 bounded resource/security 경계를 적용한 uncompressed score-partwise `.musicxml`/`.xml` staff별 primary-voice subset 및 explicit warning modal을 지원합니다. 이 목록은 rebar/pickup/custom meter grouping, hairpin/wedge·`sfz`·other dynamics, 복수 articulation·placement/direction 편집·fermata·ornaments·slur, multiple voices, 임의 notehead·event 선택/편집, semantic tuplets, linked-part layout, `.mxl`, pagination/virtualization 또는 완전한 MusicXML round-trip까지 완료됐다는 뜻은 아닙니다.

장기 권장 조합은 다음과 같습니다.

- 편집 UI: React + TypeScript + Vite 기반 SPA/PWA
- 내부 원본: 독자 `ScoreModel` 및 schema migration
- 편집: 모든 입력을 통과시키는 domain command processor
- 초기 사보: VexFlow 5 SVG adapter
- 전문 출력 후보: 자체 layout engine, 선택적으로 Verovio/MEI 검증 adapter
- 화면 글리프: SMuFL 1.4 및 self-hosted Bravura
- 재생 MVP: Web Audio, 이후 Tone.js/Sampler 또는 AudioWorklet
- 로컬 내구성: 검증된 localStorage primary + last-known-good backup → 같은 실패 계약을 유지하는 IndexedDB multi-score storage
- 클라우드: PostgreSQL metadata + S3-compatible snapshot/object storage
- 협업: 모델 안정 후 Yjs, WebSocket, server snapshot/compaction
- 데스크톱: Tauri 우선 benchmark, Chromium 일관성이 필요하면 Electron
- 고성능 코어: 프로파일링으로 확인된 병목만 Rust/WASM으로 이동

## 2. 절대 지켜야 하는 경계

### 의미 모델은 화면이 아니다

VexFlow note, SVG DOM, x/y 좌표를 저장 원본으로 사용하지 않습니다. 저장 원본은 다음 계층입니다.

```text
ScoreDocument
 ├─ metadata / tempo / measure order
 ├─ MeasureMeta
 ├─ Part
 │   ├─ InstrumentSnapshot
 │   └─ Staff
 │       └─ StaffMeasure
 │           └─ Voice[exactly 1 in schema-v1]
 │               └─ NoteEvent [dynamic?, articulation?] | RestEvent [dynamic?]
 └─ TieEdge[]
```

화면 좌표는 모델에서 파생되는 display list 또는 renderer cache입니다. 사용자 수동 배치가 도입될 때에만 의미 모델과 분리된 layout override layer에 의도를 저장합니다.

### 기보음과 실음은 다르다

원본 pitch는 written pitch입니다.

```text
soundingMidi = writtenMidi
             + transposition.chromatic
             + 12 × transposition.octaveChange
```

`diatonic`은 올바른 음이름/조표 철자에 사용합니다. concert pitch view는 projection이며 토글할 때 원본 written pitch를 파괴적으로 다시 쓰지 않습니다. MusicXML `<transpose>`도 같은 방향입니다.

### 정밀한 시간

현재 지원 서브셋은 quarter note당 960 tick으로 정수 계산합니다. 온·2·4·8·16·32·64분음표와 점 없음·한 점·겹점의 모든 조합이 정확한 정수 tick입니다. Tempo도 30–300 BPM의 정수 하나이며 MusicXML initial `<sound tempo>`와 왕복하지만 중간 tempo map은 아직 없습니다. Meter command는 numerator 1–255, power-of-two denominator, `numerator × 3840 / denominator`가 안전한 정수 tick인 경우만 허용합니다. 선택 마디부터 같은 기존 값이 이어지는 run만 바꾸고, 먼저 모든 part·staff·voice의 해당 measure duration을 새 capacity와 비교한 뒤 resulting score 전체 validator까지 실행합니다. 하나라도 overflow하거나 meter 경계 이동으로 tie의 절대 adjacency가 깨지면 원본 score를 원자적으로 반환합니다. Preset 밖의 유효한 imported meter는 Inspector에서 exact value와 `imported/custom`으로 표시하지만 임의 meter 저작 UI는 아닙니다. 현재 command는 음악을 재배치하지 않으며 rebar, pickup, custom grouping은 별도 P0입니다. Tuplet, polymeter, cadenza를 추가하기 전에 코어 시간을 정규화된 `Rational { numerator, denominator }`로 승격합니다. JavaScript float를 canonical duration이나 onset으로 저장하지 않습니다.

### Tie는 시간상 연속한 동일음만 잇는다

Schema-v1 tie edge는 같은 written pitch이며 같은 part·staff·voice에 속한 서로 다른 note 두 개만 잇습니다. Destination event start tick은 source event end tick과 정확히 같아야 하고, note 하나의 incoming/outgoing edge는 각각 최대 하나이며 graph cycle은 금지됩니다. Validator는 persisted/imported JSON에서 이 계약을 엄격히 거부합니다. MusicXML importer도 pickup/underfill을 full-meter timeline으로 정규화한 뒤 이웃하지 않게 된 tie stop을 조용히 연결하지 않고 위치가 있는 warning과 함께 건너뜁니다.

### Part, Instrument, Staff를 합치지 않는다

- Part: 총보/파트보에 연결되는 연주자 단위
- Instrument: 조옮김, 음색, 음역, 주법을 가진 시간축상의 악기
- Staff: 실제 오선과 성부 컨테이너

향후 한 Part 안의 Clarinet → Bass Clarinet 악기 교체, Piano grand staff, divisi, multi-instrument part를 표현하려면 이 구분이 필요합니다.

## 3. 포트와 어댑터

```text
Input adapters
 keyboard / pointer / touch / MIDI / command palette
                  │
                  ▼
Domain command processor
 validation / transaction / undo / change-set
                  │
                  ▼
Canonical ScoreModel
      │              │                │
      ▼              ▼                ▼
EngravingPort   PerformancePort      CodecPort
 VexFlow SVG      Web Audio       Garak / MusicXML / MIDI
 future engine    future sampler  MEI / ABC / PDF
      │
      ▼
Display list / hit regions / accessibility tree
```

키보드, 마우스, 터치, MIDI가 모델을 각각 직접 수정하면 undo·협업·검증이 서로 달라집니다. 모든 입력은 `InsertNote`, `DeleteRange`, `SetDuration`, `AddPart`, `ToggleTie` 같은 명령으로 정규화해야 합니다. 현재 수직 슬라이스는 UI 안의 snapshot history를 사용하지만, 다음 단계에서는 이 명령 API를 `packages/score-core`로 이동합니다.

## 4. 렌더링 전략

### 현재

- VexFlow 5가 실제 SVG 보표·음자리표·조표·박자·음표·쉼표·붙임줄을 생성합니다.
- 하나의 NoteEvent에 들어 있는 여러 pitch를 공유 stem·duration의 chord로 그리고 accidental은 notehead별로 계산합니다.
- 각 Part의 모든 Staff를 독립 render row로 만들고 grand staff brace와 같은 family의 part bracket을 그립니다.
- 빈 voice는 현재 meter를 whole-note `Fraction(numerator, denominator)`으로 직접 전달한 중앙 정렬 full-measure rest로 그립니다. 같은 fraction을 dynamics alignment의 ghost voice에도 사용하므로 5/8·7/8 같은 meter를 pre-scaled tick으로 오해하지 않습니다.
- 8개 meter는 exact beam group을 VexFlow에 전달하며, 조표에 포함되거나 마디 안에서 반복되는 accidental은 state resolver가 제어합니다.
- 각 system 시작과 실제 change boundary에서 key/time glyph를 그리며, key cancellation도 이전 값을 기준으로 계산합니다.
- Event의 semantic dynamic은 같은 onset의 `TextDynamics`와 alignment voice로 그리며, note/rest 자체의 duration과 spacing 의미는 바꾸지 않습니다.
- NoteEvent의 단일 semantic articulation은 VexFlow `Articulation` modifier로 leading notehead의 보표 위에 그리고 duration tick은 바꾸지 않습니다. Chord tone들은 event mark 하나를 공유하며, 복수 mark와 editable placement/direction은 아직 모델에 없습니다.
- 마디 수를 고정하지 않습니다. Measure ID→absolute-index map을 한 번 만들고 재사용하면서 event 수·dot·accidental·key/time modifier가 요구하는 최소 폭과 현재 viewport/zoom을 계산해 system을 동적으로 나눕니다. 이는 기존 measure마다 전체 order를 `indexOf`로 다시 찾던 O(n²) lookup을 제거한 것이며, 전체 layout complexity를 선형이라고 일반화하거나 pagination engine·virtualization 완료를 뜻하지 않습니다.
- 총보와 파트는 같은 ScoreDocument를 읽습니다.
- 선택 스태프 highlight와 playhead는 악보 SVG와 분리된 overlay입니다. 현재 선택은 staff row 수준이며 stable event caret/range selection은 다음 단계입니다.
- New/Add/Help/Import-warning modal은 dialog에 초기 focus를 주고 sibling UI를 `inert`로 만들며, Tab/Shift+Tab을 dialog 안에 가두고 Escape 뒤 이전 trigger focus를 복원합니다. 이는 현재 modal keyboard boundary이며 score 자체의 semantic accessibility tree 완료를 뜻하지 않습니다.

### 다음 단계

- page/system별 별도 SVG
- viewport 주변 system만 mount하는 virtualization
- source music ID → glyph/bbox/hit-region mapping
- 편집된 measure에서 영향받는 system만 invalidation
- 레이아웃 계산 Worker와 화면 SVG mount 분리
- 자동 spacing과 충돌 회피를 golden notation corpus로 검증

VexFlow 객체를 원본으로 저장하지 않으므로, 특정 기보가 막힐 때 자체 엔진이나 다른 adapter로 점진적으로 교체할 수 있습니다.

## 5. 라이브러리 선택과 라이선스

| 후보 | 현행 역할 | 라이선스 | 결정 |
|---|---|---|---|
| [VexFlow 5](https://github.com/vexflow/vexflow) | SVG/Canvas 저수준 기보 | MIT | 현재 편집 렌더러로 채택 |
| [fast-xml-parser 5](https://github.com/NaturalIntelligence/fast-xml-parser) | MusicXML XML 파싱 | MIT | uncompressed score-partwise primary-voice import에 채택; `.mxl`과 전체 의미 round-trip은 별도 acceptance |
| [OpenSheetMusicDisplay](https://github.com/opensheetmusicdisplay/opensheetmusicdisplay) | MusicXML 읽기/표시 | BSD-3-Clause | 핵심 편집 모델로 사용하지 않음 |
| [Verovio](https://github.com/rism-digital/verovio) | MEI/WASM/SVG/출력 | LGPLv3 | 별도 Worker adapter 및 품질 비교 후보 |
| [abcjs](https://github.com/paulrosen/abcjs) | ABC→SVG/재생 | MIT | quick-entry/리드시트 후보 |
| [MuseScore Studio](https://github.com/musescore/MuseScore) | 완전한 데스크톱 악보 앱 | GPLv3 | 독점 클라이언트에 임베드하지 않고 QA 참조 |
| [Tone.js](https://github.com/Tonejs/Tone.js) | Web Audio scheduler/synth | MIT | P0 이후 sampler/playback adapter 후보 |
| [Yjs](https://github.com/yjs/yjs) | CRDT/offline sync | MIT | 모델 안정 후 협업 계층 후보 |

현재 package는 `private: true`인 비공개/닫힌 알파입니다. 설치 artifact의 버전별 근거와 실제 배포 전 미해결 gate는 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)에 기록합니다. Release source는 VexFlow의 `vexflow/bravura` entry를 선택하며, 최종 local production build에는 Academico Regular/Bold와 Bravura의 WOFF2 payload 3개만 확인됐습니다. Chunk 안에 Gonville·Petaluma·Petaluma Script·Leland 같은 generic font/API name 문자열이 남는 것과 해당 font binary가 ship되는 것은 구분합니다. 이 font들은 현재 payload에 포함되지 않으며 향후 실제로 채택할 때 provenance·license·artifact를 다시 검토합니다. 공개·상용 배포 전에는 실제 shipped Academico/Bravura의 완전한 OFL text와 copyright notice를 사용자가 접근 가능한 Licenses surface에 제공하고, 배포 asset이 검증한 release build와 일치하는지 확인하며, production artifact의 transitive SBOM/license scan도 닫아야 합니다.

OSMD는 공식 문서상 완전한 시각 편집기가 아니고 VexFlow 내부 패치 의존성이 있습니다. Verovio의 Edit API는 공식 문서상 experimental이며 LGPL 고지/수정 공개 경계를 지켜야 합니다. MuseScore 웹 빌드는 공식 저장소에서도 experimental/internal이고 GPLv3이므로 비공개 상용 앱의 빠른 WASM 코어로 간주하지 않습니다.

## 6. 파일 포맷

### native Garak

현재는 readable versioned JSON입니다.

```json
{
  "format": "garak-score",
  "schemaVersion": 1
}
```

장기적으로 `.garak` 패키지는 manifest, score data, styles, layout overrides, attachments, previews를 담습니다. 앱 버전과 파일 schema 버전을 분리하고 순차 migration 및 read-back validation을 유지합니다.

Schema-v1 validator는 각 ordered staff-measure cell에 voice를 정확히 하나만 허용합니다. 구조 상한은 ordered measure 20,000, part 256, 전체 staff 512, staff×ordered-measure cell 10,000, voice 10,000, event 50,000, note 100,000, tie 50,000입니다. Absolute native timeline은 536,870,910 tick으로 제한하며, 이는 960→480 PPQ 변환 뒤 SMF VLQ 최대 delta `0x0FFFFFFF`의 두 배입니다. 첫 200개 validation error 뒤에는 deterministic omission summary만 반환합니다.

Score/measure/part/staff/event/catalog ID는 256 UTF-16 code unit, voice ID는 1,024, note ID와 tie endpoint reference는 512, tie ID는 2,048로 제한합니다. Part/staff/voice/event/note/tie object ID는 하나의 global namespace에서 중복을 거부하고, measure ID는 `measureOrder` 안에서 별도로 유일해야 하며 metadata key/id가 일치해야 합니다. Score ID와 instrument catalog ID는 이 object namespace에 등록하지 않습니다. Title/subtitle/composer/part/instrument/family name은 200, short name은 80, copyright는 500, `updatedAt`은 64 code unit이 상한입니다. Color string은 64 code unit 이하이면서 `#RRGGBB`여야 합니다. 이 경계는 untrusted native JSON을 traversal하기 전에 폭발적 구조와 문자열을 제한하기 위한 schema-v1 계약입니다.

### MusicXML 4.0

[MusicXML 4.0](https://www.w3.org/2021/06/musicxml40/)은 주 교환 포맷이며 native 원본으로 사용하지 않습니다. 현재 exporter는 실제 measure별 key/time change, 조옮김 파트의 written key, dots·accidental display·strict contiguous tie, chord, full-measure rest를 출력합니다. 첫 마디에는 정수 global tempo의 metronome과 `<sound tempo>`를 함께 기록합니다. Semantic dynamic은 event onset의 `<direction placement="below">` 안에 staff·voice, `<dynamics>`, 대응 `<sound dynamics>`를 기록합니다. 단일 articulation은 staccato·tenuto·accent를 같은 이름의 element로, marcato를 `<strong-accent type="up"/>`으로 내보내며 chord에서는 leading note 하나에만 기록합니다. Tie와 articulation이 같은 note에 있으면 각각 별도 `<notations>`를 만들지 않고 한 container에 합칩니다. 멀티 스태프 파트는 `<staves>`, 번호가 붙은 `<clef>`, `<staff>`, schema-v1 단일 voice, staff stream 사이 `<backup>`을 사용해 모든 staff를 보존합니다. Opaque native part ID는 `[A-Za-z_][A-Za-z0-9_.-]*` 형태의 유일한 MusicXML ID로 정규화하고 part-list/body/score-instrument/midi-instrument reference가 같은 mapping을 공유합니다. MIDI route의 port는 [MusicXML `<midi-device>` 계약](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/midi-device/)에 맞춰 1–16으로 기록합니다.

현재 importer는 uncompressed score-partwise `.musicxml`/`.xml`의 metadata, 첫 유효한 30–300 BPM tempo, part/instrument, multi-staff, clef/key/time, staff별 primary-voice note/rest/chord/tie, 32nd/64th·겹점 subset을 canonical `ScoreDocument`로 바꿉니다. Decimal tempo는 범위 안에서 정수로 반올림하고 뒤의 tempo change는 initial global tempo를 바꾸지 않은 채 warning으로 남깁니다. Part-list 순서를 보존하고 measure source cursor에서 `divisions`, `backup`, `forward`를 처리하며, 선택 voice의 표현 가능한 시간축 gap을 정확한 rest로 materialize합니다. Voice 1이 있으면 우선하고 없으면 staff에서 처음 나타난 voice 하나를 선택하며 나머지는 건너뜁니다. 겹침·마디 초과·표현 불가능 duration·선택되지 않은 voice는 조용히 위치를 바꾸지 않고 score 위치가 포함된 warning으로 전달합니다. `implicit="yes"`는 pickup metadata가 보존되지 않고 explicit measure가 된다고 알리며, 마지막이 아닌 underfilled source measure는 full active meter 때문에 다음 measure start가 늦어지는 tick 차이를 알립니다. 이 정규화 뒤 noncontiguous tie stop은 생성하지 않습니다. 지원되는 `ppp`–`fff` `<direction-type><dynamics>`는 direction의 staff와 선택 primary voice에 맞는 다음 materializable note/rest event에 붙고, pending mark는 `backup`/`forward`와 마디 경계를 넘어 carry합니다. Offset은 musical cursor를 움직이지 않고 warning과 함께 무시하며, above placement는 below로 정규화해 warning을 냅니다. `<articulations>` 안의 staccato·tenuto·accent·strong-accent는 각각 같은 event value 또는 marcato로 가져옵니다. Below placement와 downward strong-accent는 현재 고정된 위쪽 표현으로 warning 정규화하며, 한 note나 chord tone들에서 서로 다른 지원 mark가 충돌하면 source order상 뒤의 mark 하나를 warning과 함께 남깁니다. Rest articulation과 `<articulations>` 안의 지원하지 않는 member는 warning과 함께 건너뜁니다.

Uncompressed import의 현재 안전 경계는 UI file chooser 10 MiB, importer `xml.length` 67,108,864 UTF-16 code unit, part 256, part당 staff 32, 전체 staff 512, measure 20,000, staff×measure cell 10,000, source measure child element 100,000입니다. Materialized 결과는 event 50,000, note 100,000, tie 50,000을 넘지 못합니다. 누적 full-meter capacity는 materialization 전에 계산해 native absolute timeline 상한 536,870,910 tick을 넘으면 거부합니다. Source part ID는 256 code unit으로 제한하고 내부 `part-1`/staff/voice/event/note ID에 긴 외부 ID를 증폭하지 않습니다. Imported name 200, short name 80, rights 500 code unit 상한도 native validator와 맞춥니다. Warning collector는 중복을 제거하고 최대 200개를 노출하며 각 항목을 500 code unit으로 자르고, 초과분이 있으면 summary 한 개만 덧붙입니다.

XML well-formedness를 먼저 검사하고 내부 DTD subset/entity 선언, 중복/깨진 part reference, 안전하지 않은 duration을 거부하거나 진단합니다. `.mxl`, multiple voices, semantic tuplets, hairpin/wedge·`sfz`·other/sound-only dynamics, composite dynamic 원형 의미와 words/other directions, 복수 articulation 조합, editable articulation placement/direction, slur, repeats, layout round-trip, external DTD 변형을 포함한 확장 보안 corpus와 parser depth/node budget은 아직 지원하지 않습니다. 지원된 8단계 mark가 한 `<dynamics>`에 여러 개 있으면 마지막 mark로 warning 정규화합니다. `<fermata>`와 `<ornaments>`는 `<articulations>`의 member가 아니라 sibling notation category이므로 현재 articulation importer가 순회하거나 보존하지 않으며, 이 손실에는 아직 개별 warning도 없습니다. 압축 import를 도입할 때는 MXL zip bomb/path traversal과 file-count/uncompressed-size 제한도 별도로 검증합니다.

### MIDI

MIDI는 연주 데이터입니다. enharmonic spelling, staff, voice, beam, layout을 잃으므로 저장 원본이 될 수 없습니다. 현재 Export는 모든 스태프의 schema-v1 voice, written pitch가 아닌 sounding pitch, strict tie chain으로 병합된 duration을 사용합니다. Instrument family가 아니라 clef를 분류 기준으로 삼아 percussion clef만 GM channel 10에 두고, timpani·glockenspiel 같은 pitched percussion은 melodic route에 둡니다. 실제 meter change마다 time-signature meta event를 내보내며, dynamic은 staff마다 기본 `mf`에서 시작해 다음 표시까지 지속되는 note-on velocity가 됩니다. Accent는 이 velocity에 14, marcato는 24를 더해 127에서 clamp하고 staccato·tenuto는 velocity를 바꾸지 않습니다. Staccato는 gate duration을 절반으로 줄이지만 tenuto는 아직 일반 gate를 연장하지 않습니다. Native 960 PPQ tick은 SMF 480 PPQ로 `/2` 반올림하고, note-off는 최소 start+1 tick입니다. VLQ는 표준 최대 `0x0FFFFFFF`까지만 encode합니다.

각 port는 channel 10을 제외한 15개 melodic route를 제공하며, pitched part는 16 port의 240개 route 안에서 `(port, channel)`이 겹치지 않습니다. Unpitched-percussion part는 port마다 channel 10 하나씩, 최대 16개를 독립적으로 사용합니다. MusicXML `<midi-device port>`는 1-based 1–16, SMF `FF 21` port meta event는 같은 route를 0-based 0–15로 기록하며, 어느 상한이든 넘으면 export가 명시적 오류를 반환합니다.

SMF note-off는 개별 note ownership을 식별할 수 없으므로 같은 port/channel/pitch의 겹친 interval은 긴 하나로 합칩니다. Later overlapping reattack은 손실되고 앞 interval velocity를 유지하며, 정확히 같은 onset이면 큰 velocity를 사용합니다. 정확히 인접한 note는 분리하고 double-dotted 64th 같은 반 tick 경계도 공동 off/on tick으로 quantize해 overlap을 만들지 않습니다. Key-signature meta event는 현재 출력하지 않습니다. 이 overlap/quantization 정책은 명시적 export compromise이며, MIDI import는 quantization, voice separation, sustain, tuplet 추론을 가진 별도 제품 기능입니다.

### Live Web Audio playback

Playback plan은 native 960-tick timeline과 tempo를 seconds로 바꿉니다. Accent는 dynamic-derived velocity에 14, marcato는 24를 더해 127에서 clamp하고 staccato·tenuto는 velocity를 바꾸지 않습니다. Staccato는 notated duration을 먼저 50%로 줄이며 tenuto는 아직 연장하지 않습니다. 그 결과를 포함한 모든 note에 공통 90% gate를 적용하고 최소 5 ms를 보장합니다. UI oscillator envelope attack은 18 ms와 note duration의 35% 중 작은 값이어서 32nd/64th note에서도 release 전에 attack이 끝납니다. 한 번에 scheduler에 넣는 note는 600개입니다. 가장 이른 onset부터 잘라내며 한 onset group 자체가 600개보다 크면 part별 queue를 round-robin해 한 part가 window를 독점하지 않게 합니다. Status는 truncation을 명시합니다. 이는 bounded alpha audition이며 전체 score streaming scheduler나 고품질 sample playback 완료를 뜻하지 않습니다.

### MEI/ABC

MEI는 학술·고음악·비평판과 Verovio 연동의 보조 포맷, ABC는 리드시트와 빠른 텍스트 입력 포맷으로 둡니다.

## 7. 저장과 협업

현재 browser storage 계약은 다음과 같습니다.

- `garak.score.v1`이 primary, `garak.score.v1.backup`이 last-known-good snapshot입니다.
- Load는 primary를 parse·domain-validate하고, 누락·손상·read failure이면 backup을 독립적으로 검증합니다. 검증된 backup이 있으면 recovery status와 함께 열고, 둘 다 쓸 수 없으면 손실 상태를 알린 뒤 fresh score를 엽니다. Load 자체는 storage를 다시 쓰지 않습니다.
- Backup recovery 또는 unrecoverable fresh fallback 뒤에는 damaged primary/backup raw를 보존하려고 autosave를 비활성화합니다. 이후 편집도 메모리에만 남고, 사용자가 Save now 또는 New를 명시적으로 실행해야 autosave가 다시 켜집니다.
- Save는 score validation과 직렬화를 먼저 수행합니다. 유효한 primary와 새 payload가 같으면 no-op이며 backup을 흔들지 않습니다. 다르면 기존 유효 primary 원문을 backup에 먼저 쓴 뒤 새 primary를 기록합니다. 누락되거나 잘못된 primary는 backup에 복사하지 않습니다.
- Backup write 실패면 primary를 건드리지 않습니다. Primary quota/write 실패도 이전 primary와 방금 보존한 last-known-good을 남기고 실패 status를 표시합니다. 이 계약은 Web Storage의 개별 `setItem` atomicity를 전제로 합니다.
- Snapshot undo/redo의 past/future는 각각 현재 score에 가까운 쪽을 남기며 최대 100개와 UTF-8 JSON serialized-size proxy 8 MiB 중 먼저 닿는 한도로 trim합니다. 단일 snapshot이 8 MiB를 넘더라도 최소 한 단계는 보존합니다. 이는 메모리 상한이지 command-level diff history나 crash journal은 아닙니다.
- 현재는 device-local 단일 draft입니다. IndexedDB, multi-score library, schema migration, quota/eviction·persistent-storage 관리 UI, account/cloud sync는 다음 단계입니다.

장기 목표 구조는 다음과 같습니다.

```text
Browser
 command transaction
 → ScoreModel
 → IndexedDB snapshot/update log
 → Yjs transaction
 → WebSocket sync

Server
 auth/ACL
 → update append
 → periodic snapshot + compaction
 → PostgreSQL metadata
 → object storage native/export assets
```

CRDT가 데이터 구조를 합쳤다는 사실은 음악적으로 유효하다는 뜻이 아닙니다. 동시 meter와 duration 수정처럼 합친 뒤 마디 용량이 깨질 수 있으므로 client/server가 같은 domain validator를 실행하고, 자동으로 조용히 변형하지 말고 충돌 영역과 되돌릴 수 있는 repair command를 보여줘야 합니다.

## 8. 데스크톱과 모바일

웹 코어에 다음 포트를 둡니다.

- FileSystemPort
- MidiDevicePort
- AudioDevicePort
- WindowMenuPort
- SecureStoragePort
- UpdatePort

Tauri는 작은 배포 크기와 capability 기반 IPC가 장점이지만 OS별 WebView의 font metrics, SVG, Web Audio, MIDI, 인쇄 차이를 검증해야 합니다. Electron은 크지만 Chromium 일관성이 높습니다. 40보표 렌더, Bravura metrics, MIDI latency, SVG→PDF, VoiceOver/NVDA 기준 benchmark를 통과한 쪽을 선택합니다.

모바일은 웹 화면 축소판이 아닙니다. 태블릿 PWA에서 selection handle, 펜/터치, 가상 건반, audio permission을 먼저 검증하고 이후 native shell을 평가합니다.

## 9. 품질 목표

- 입력 → selection overlay p95 50ms 이하
- 현재 system 부분 재조판 p95 100ms 이하
- 모든 성공한 편집 명령 undo 가능
- 오프라인에서 입력과 로컬 저장 가능
- import 손실은 모두 사용자에게 보고
- 동일 앱/폰트/페이지 설정에서 결정적인 출력
- 32 staff × 200 measures에서 viewport 입력 p95 80ms 이하(P0 목표)
- 80 staff × 1,000 measures에서 virtualization 유지(P1 목표)
- golden corpus에서 glyph 잘림과 치명적 충돌 0

숫자는 측정 기기와 브라우저를 고정한 제품 acceptance target이며, 현재 알파가 이미 달성했다고 주장하지 않습니다.
