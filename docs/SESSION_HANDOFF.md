# 다음 세션 이어하기

마지막 갱신: 2026-08-24 KST

이 문서는 “더 필요한 것이 있으면 기억해두고 나중에 계속”이라는 요청을 위해 유지하는 살아 있는 handoff입니다.

## 현재 공개 결과

- `/`에서 Garak 알파 편집기가 실행됩니다.
- 첫 방문은 Chamber orchestra 예제 score를 보여주고, New에서는 Solo, String quartet, Chamber orchestra, Symphony orchestra를 선택할 수 있습니다.
- 고유 ID 140개의 orchestral, keyboard, voice preset을 검색해 part를 추가할 수 있습니다.
- Score와 Part 보기는 같은 `ScoreDocument`를 읽습니다. Part 보기는 아직 독립 linked-part layout이 아닙니다.
- VexFlow SVG가 모든 part·staff·measure를 렌더하고, grand staff brace와 family bracket을 표시합니다.
- Piano·Harp·Celesta·Harpsichord·Accordion·Harmonium·Bandoneon은 2 staff, Organ은 3 staff로 생성됩니다.
- 악보 행 또는 Inspector에서 staff를 선택한 뒤 해당 staff에 note/rest 입력, 마지막 event 삭제, tie를 적용할 수 있습니다.
- Schema-v1 validator는 각 ordered staff-measure cell에 editable Voice를 정확히 1개만 허용합니다. Tie는 같은 written pitch·part·staff·voice의 정확히 contiguous event만 잇고 incoming/outgoing 각 1개와 acyclic graph를 강제합니다.
- 온음표부터 64분음표까지와 점 없음·한 점·겹점을 정수 tick으로 입력·사보·재생·MusicXML 왕복할 수 있습니다.
- Chord mode에서 선택 staff의 마지막 note event에 pitch를 추가하며 event onset·duration과 SVG·playback·MIDI·MusicXML 의미를 보존합니다. Backspace/Delete 또는 Inspector 버튼은 마지막에 추가한 tone 하나만 제거하고 event·리듬을 유지하며 해당 note의 tie를 정리합니다.
- 장·단조 -7~+7 fifths의 30개 concert key를 선택하고, 조옮김 part의 written key를 UI·SVG·MusicXML에 반영합니다.
- meter는 2/4, 3/4, 4/4, 5/8, 6/8, 7/8, 9/8, 12/8의 8개이며 default beam group과 exact whole-note-fraction full-measure rest가 meter를 따릅니다. Preset 밖의 유효한 imported meter도 Inspector에서 exact 값과 `imported/custom` 표기로 남습니다.
- Inspector에서 시작 마디를 고르면 key/time이 그 값의 다음 기존 change boundary 직전까지만 바뀌고 뒤 change는 유지됩니다. Meter는 1–255 정수 numerator, power-of-two denominator, exact integer-tick capacity만 허용하며 모든 part·staff·voice overflow와 resulting-score validation을 변경 전에 실행합니다. Meter 변경이 tie adjacency를 깨도 전체 변경을 원자 거부합니다.
- Tempo는 정수 30–300 BPM이며 첫 유효한 MusicXML `<sound tempo>` import와 첫 마디 metronome/`<sound>` export를 왕복합니다. 이후 tempo change는 warning이고 global tempo map 편집은 아직 없습니다.
- `ppp`–`fff` 8단계 또는 None의 dynamic을 선택 staff 마지막 note/rest event에 attach·replace·clear합니다. VexFlow `TextDynamics`, staff별로 다음 표시까지 지속되는 playback/MIDI velocity, MusicXML direction export가 같은 semantic 값을 사용합니다. Uncompressed MusicXML의 같은 8단계 dynamic direction은 지정 staff·선택 primary voice의 다음 표현 가능한 event에 붙고 마디 경계를 넘어 carry합니다.
- system은 고정 마디 수가 아니라 내용과 viewport에 따른 동적 spacing으로 나뉘며 measure ID→absolute-index map을 재사용해 반복 `indexOf` O(n²) lookup을 제거했습니다. 전체 layout complexity를 선형이라고 일반화할 수는 없고 pagination/virtualization도 아닙니다.
- 빈 마디 추가, 음악이나 tie가 없는 마지막 빈 마디 제거, 입력 중 자동 마디 추가가 모든 staff 구조를 보존합니다.
- Undo/redo past/future는 각각 현재 쪽 snapshot을 유지하면서 최대 100개와 UTF-8 JSON serialized-size proxy 8 MiB 중 먼저 닿는 경계에서 trim합니다. 예산보다 큰 단일 snapshot도 최소 1개는 유지합니다.
- Multi-staff Web Audio playback은 note duration의 90%·최소 5 ms gate, 18 ms 또는 duration 35% 이하 attack을 사용합니다. 한 번에 600음까지 가장 이른 onset부터 고르고, 한 onset이 한도를 넘으면 part별 round-robin으로 공정하게 선택하며 truncation status를 표시합니다.
- 검증된 primary + last-known-good backup local autosave/recovery와 native/MusicXML/MIDI export가 연결돼 있습니다. Primary 손상에서 backup을 열거나 두 snapshot이 모두 손상되어 fresh score를 열면 damaged raw를 보존하려고 명시적 Save now/New까지 autosave가 멈춥니다. Corruption·quota/write 실패를 성공과 구분해 status로 알립니다.
- File chooser에서 uncompressed score-partwise `.musicxml`/`.xml`의 staff별 primary-voice subset을 import하고, part-list 순서와 `divisions`·`backup`·`forward` 시간축, 표현 가능한 gap rest, chord/tie, 32nd/64th·겹점, 8단계 dynamic direction의 next-event anchor를 보존합니다.
- Import는 malformed XML·내부 DTD subset/entity 선언을 거부하고 UI 10 MiB, core 67,108,864 UTF-16 code unit, 256 part, part당 32/전체 512 staff, 20,000 measure, 10,000 staff×measure cell, 100,000 source measure child element 상한을 적용합니다. Materialized event/note/tie 상한은 50,000/100,000/50,000이며, 누적 full-meter timeline은 materialization 전에 native 536,870,910 tick 상한을 검사합니다.
- Import warning은 중복 제거된 visible 200개, 각 500 UTF-16 code unit과 필요할 때 omission summary 1개로 제한합니다. `implicit="yes"`/pickup metadata를 explicit measure로 바꾸는 손실, non-final underfill의 full-meter 지연 tick, 정규화 뒤 noncontiguous tie skip, 미지원·겹침·마디 초과 요소를 score 위치와 함께 표시합니다.
- MusicXML source ID는 256 code unit으로 제한하고 compact internal descendant ID에 증폭하지 않습니다. Exporter는 opaque native part ID를 XML 이름 규칙에 맞는 unique ID로 바꾸고 모든 reference에서 같은 mapping을 사용합니다.
- MusicXML은 실제 key/time boundary, initial tempo, dynamic direction, multi-staff attributes·staff·voice·backup·full-measure rest를 보존합니다. MIDI는 실제 time-signature boundary와 staff별 dynamic velocity를 포함하며, MIDI와 playback 모두 모든 staff의 schema-v1 voice를 사용합니다. MIDI는 VLQ `0x0FFFFFFF` 상한, 960→480 PPQ 반올림과 최소 1-tick note를 적용하고, 같은 port/channel/pitch overlap은 긴 interval로 합쳐 later reattack/velocity를 잃는 compromise가 있습니다.
- MIDI/MusicXML routing은 instrument family가 아니라 clef를 기준으로 합니다. Percussion clef만 GM channel 10을 쓰고 timpani·glockenspiel 같은 pitched percussion은 melodic route를 사용합니다. Port마다 melodic route 15개, 전체 pitched 240개와 독립 unpitched-percussion part 16개가 상한이며 초과 시 명시적으로 실패합니다. MusicXML [`<midi-device>` port](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/midi-device/)는 1–16, 같은 SMF `FF 21` port는 0–15입니다.
- New/Add/Help/Import-warning modal은 dialog initial focus, sibling `inert`, Tab/Shift+Tab trap, Escape close, 이전 focus 복원을 적용합니다.
- `public/og.png`에는 검증된 Garak social card가 있습니다.

Native validator hard ceiling은 ordered measure 20,000, part 256, 전체 staff 512, staff×measure cell/voice 10,000, event 50,000, note 100,000, tie 50,000, absolute timeline 536,870,910 tick입니다. 첫 200개 validation error 뒤에는 omission summary를 반환합니다. Base ID 256, voice ID 1,024, note/tie reference 512, tie ID 2,048 UTF-16 code unit 제한과 part/staff/voice/event/note/tie object ID의 global uniqueness도 유지합니다.

## 검증 기준선

다음 세션 시작 시 먼저 실행합니다.

1. `npm install`
2. `npm run typecheck`
3. `npm run lint`
4. `npm run test:unit`
5. `npm test`
6. `npm run dev`

자동 테스트의 정확한 개수와 통과 상태는 위 명령의 최신 출력이 기준입니다. Production build, 음악 코어·MusicXML import·server-render 회귀, typecheck, lint를 모두 통과하는 상태를 기준선으로 삼습니다.

실제 브라우저 검증은 자동 테스트와 별도입니다. 루트 작업에서 강제 reload 후 조옮김 written key, 6/8 beam, system에서의 박자표 중복, full-measure rest, 55/82/100/150% zoom과 scroll, duration 아이콘 glyph, brace/bracket·spacing, runtime/console 오류를 PNG·DOM 수치와 함께 별도로 확인했습니다.

MusicXML/Chord acceptance도 실제 file chooser로 확인했습니다. `.musicxml`을 고르면 제목·작곡가·Violin·G major·1 measure·G+B 2-note chord가 즉시 편집 가능한 상태로 열렸고, 지원하지 않는 Voice 2는 modal에 정확히 warning 1건으로 표시됐습니다. Continue editing 후 Chord mode에서 D4를 추가해 event count가 1로 유지되고 Inspector가 `Chord · 3 notes`, playback 상태가 `Playing 3 notes at ♩ = 96`인 것을 확인했습니다. 이 브라우저 증거는 자동 테스트 개수에 합산하지 않습니다.

## 수동 smoke

1. String quartet을 새로 만들고 Violin I을 선택합니다.
2. Concert key를 G major, meter를 6/8로 바꿉니다.
3. `4 C D E F G A`로 eighth note 여섯 개를 입력해 3+3 beam을 확인합니다.
4. 빈 마디를 추가한 뒤 마지막 빈 마디만 제거되는지 확인합니다.
5. Piano를 추가하고 lower staff를 클릭한 뒤 `3 C D E R`을 입력합니다.
6. 같은 pitch 두 번 입력 후 `T`, 이어 `Cmd+Z`, `Cmd+Shift+Z`를 확인합니다.
7. Space playback과 Score/Part 전환을 확인합니다.
8. JSON, MusicXML, MIDI export 후 새로고침 복구를 확인합니다.
9. Primary-voice chord와 미지원 Voice 2가 함께 든 `.musicxml`을 import해 warning 1건, chord 사보, Continue editing을 확인합니다.
10. `6`, `7`, `.`을 사용해 32nd·64th와 점 없음→한 점→겹점 순환을 확인합니다.
11. Chord mode에서 imported chord에 D4를 추가하고 event count 1, Inspector 3 notes, 3-note playback을 확인합니다.
12. Chord mode에서 Backspace로 마지막 D4 tone만 제거한 뒤 event count·duration이 그대로이고 한 번의 undo로 3-note chord가 복원되는지 확인합니다.
13. 최소 3마디에서 둘째 마디부터 key/time을 바꿔 다음 기존 change 직전까지만 적용되는지 확인하고, 축소한 meter에 넘치는 다른 part/staff/voice가 있으면 score 전체가 바뀌지 않는지 확인합니다.
14. 선택 staff 마지막 note와 rest에서 dynamic을 attach→replace→None으로 바꾸고, SVG 표시·다음 마디 playback velocity·MusicXML direction·MIDI velocity를 확인합니다. Export한 파일을 다시 import해 staff별 note/rest dynamic이 보존되는지도 확인합니다.
15. 저장을 두 번 바꿔 primary와 backup을 만든 뒤 primary만 손상시켜 last-known-good 복구 status를 확인합니다. Quota/write 실패를 모의할 때는 기존 primary가 유지되고 성공 status가 나오지 않아야 합니다.
16. Backup recovery 직후 한 번 편집하고 기다려 damaged primary raw가 그대로인지 확인한 뒤 Save now 또는 New에서만 autosave가 다시 시작되는지 확인합니다.
17. Preset 밖의 유효한 imported meter가 Inspector에 `imported/custom`으로 보이고, 5/8·7/8 빈 마디가 중앙 정렬 full-measure rest로 그려지는지 확인합니다.
18. New/Add/Help/Import warning modal마다 focus가 dialog 안에 갇히고 배경이 inert이며 Escape 후 trigger로 돌아오는지 확인합니다.

## 다음 P0 구현 순서

순서를 바꾸지 않습니다. 각 항목의 전체 acceptance와 공식 비교 문서는 [ROADMAP.md](ROADMAP.md)에 있습니다.

### 1. Chords — 현재 subset 확장

- 현재 Chord mode는 마지막 note event에 pitch를 추가하고 마지막 추가 tone만 제거하며 chord 단위 stem·duration, 동시 playback/MIDI, MusicXML `<chord/>` import/export, 관련 tie cleanup을 지원
- 다음은 stable notehead별 임의 선택·수정·삭제·tie, 임의 caret onset chord, collision corpus, range edit
- chord symbol은 sounding chord와 별도 semantic object로 구현

### 2. Voices

- Staff당 Voice 1–4, 독립 rhythm/rest와 voice별 입력·삭제
- stem/beam/collision 규칙, 마디 용량, playback/MusicXML onset 보존

### 3. Selection과 caret

- stable event ID 기반 caret, 단일·불연속·range selection
- keyboard/mouse 확장, copy/cut/paste/delete/transpose
- undo/redo selection 복원, scroll와 접근성 announcement

### 4. Rebar와 key/time change 확장

- 현재 선택 measure부터 같은 값의 run 끝까지만 key/time을 변경하고 다음 기존 boundary를 보존하며, meter gate와 전체 stream overflow 사전 거부를 지원
- 다음은 overflow 음악의 rebar, 경계 note 분할·tie, pickup, insert/delete measure, custom additive/compound grouping
- stable selection에서 boundary 삭제·병합, courtesy 정책과 한 transaction undo

### 5. Tuplets

- Rational duration, actual:normal과 parent span
- 최소 2–9 divisions, bracket/number, 정확한 playback·MusicXML
- nested tuplet은 같은 불변식과 안전 제한으로 확장

### 6. Expressions — semantic dynamics subset 확장

- 현재 `ppp`–`fff`/None을 선택 staff 마지막 event에 attach·replace·clear하고 SVG·staff별 지속 playback/MIDI·MusicXML export 지원. Import는 같은 8단계 direction을 staff·선택 primary voice의 다음 event에 붙여 measure를 넘어 carry
- 다음은 임의 event/time-position 선택, imported offset·placement 보존, hairpin/wedge, `sfz`·other dynamic과 composite 원형 의미, interpolation과 reflow-safe anchor
- articulation, expression/tempo text, rehearsal mark, collision과 총보/파트 의미 보존

### 7. Repeats

- repeat barline, play count, volta, D.C./D.S./Coda/Fine
- 결정론적 traversal과 cycle 진단, playback/MIDI/MusicXML 일치

### 8. Linked-part layout

- 총보/파트 음악 데이터 공유와 양방향 수정 반영
- page/system break, spacing, margin 등 part별 layout override 분리
- batch PDF/MusicXML과 총보 데이터 비오염

### 9. MusicXML import — 현재 subset 확장

- 현재 uncompressed score-partwise `.musicxml`/`.xml`의 staff별 primary-voice metadata/part/staff/key/time/note/rest/chord/tie, 32nd/64th·겹점, 8단계 dynamic direction next-event/measure-carry, source cursor의 `divisions`/`backup`/`forward`, 정확한 gap rest와 위치 기반 warning 지원
- malformed XML·내부 DTD subset/entity 거부와 UI/core XML·part·staff·measure 상한 적용
- 다음은 `.mxl`, multiple voices, tuplets, dynamic subset 밖의 directions/expressions, repeats, layout intent
- parser depth/node budget, external DTD/entity 변형 corpus, 더 구조화된 loss report와 canonical round-trip corpus

### 10. Pagination과 virtualization

- page 설정과 automatic/manual break, 화면/PDF 경계 일치
- page/system별 SVG 및 viewport+overscan mount
- offscreen selection/caret/playback 정확성과 측정 가능한 latency/scroll budget

## P0와 병렬로 유지할 기반 작업

- UI의 snapshot helper를 changed IDs·affected measures·selection before/after를 반환하는 command processor로 이동
- 현재 primary + last-known-good localStorage 계약을 보존하며 IndexedDB와 multi-score library로 이동
- schema migration runner와 quota/eviction·persistent-storage 관리 UI
- self-hosted SMuFL font-ready gate와 golden engraving corpus
- percussion map, instrument change, concert/transposed view
- metronome, tempo map, start position, loop, volume/pan mixer
- semantic accessibility tree와 VoiceOver/NVDA 시나리오

## 알려진 제한과 기술 부채

- initial example score는 각 part 첫 staff의 첫 마디에 시각 확인용 motif가 있고, New로 만든 score는 빈 악보로 시작합니다.
- Schema-v1은 각 staff-measure cell에 Voice를 정확히 1개만 허용합니다. MusicXML import는 Voice 1이 있으면 우선하고, 없으면 처음 나타난 voice 하나만 선택하며 나머지를 warning과 함께 버립니다.
- Chord mode의 last-event pitch 추가와 마지막 추가 tone 제거 subset은 지원하지만 stable notehead의 임의 selection·수정·삭제·tie와 chord symbol은 없습니다.
- Key/time은 선택 measure부터 다음 기존 change boundary 직전까지 바꿀 수 있고 overflow/resulting-score validation은 전체 변경 전에 거부합니다. 음악을 자동 재배치하는 rebar, pickup metadata, custom meter/beam authoring은 없습니다. Imported custom meter는 표시만 보존합니다.
- Dynamics 편집은 선택 staff의 시간상 마지막 note/rest event만 대상으로 합니다. MusicXML import는 8단계 dynamic direction을 다음 선택-primary-voice event에 붙이는 subset이며, offset은 cursor를 움직이지 않고 warning과 함께 무시하고 above placement는 below로 정규화합니다. 지원 mark가 여러 개인 composite도 warning과 함께 마지막 mark로 정규화합니다. Hairpin/wedge, `sfz`·other/sound-only dynamic, composite 원형 의미, 비선택 voice와 임의 event selection은 없습니다.
- playback은 oscillator fallback이고 실제 GM program별 sample을 사용하지 않습니다.
- Tie chain은 exact same-pitch/stream adjacency만 허용하고 playback/MIDI에서 하나의 지속음으로 합쳐집니다. 이후 articulation과 pedal을 더해도 이 불변식을 유지해야 합니다.
- Live playback은 oscillator fallback이며 600-note scheduling window 뒤를 재생하지 않습니다. MIDI는 480 PPQ quantization과 same-port/channel/pitch overlap merge로 later reattack을 버립니다. 멀티 포트 routing은 지원하지만 exact expressive reattack은 여전히 보존하지 않습니다.
- MusicXML import는 uncompressed score-partwise `.musicxml`/`.xml`의 staff별 primary voice와 8단계 dynamic direction subset으로 제한됩니다. `.mxl`, multiple voices, semantic tuplets, 나머지 directions/expressions, repeats, layout round-trip, parser depth/node budget과 광범위한 외부 앱 compatibility corpus는 아직 없습니다.
- 전체 score를 multi-system SVG 하나로 그립니다. 수백 measure 전에 page/system pagination·virtualization이 필요합니다.
- zoom은 glyph와 canvas를 scale하고 사용 가능한 logical width를 다시 계산하지만, 출판용 page reflow mode와는 아직 분리되지 않았습니다.
- playhead는 시간 진행을 보여주지만 정확한 event bbox를 따라가지 않습니다. DisplayList source ID mapping 후 수정합니다.
- localStorage는 검증된 primary와 last-known-good backup을 쓰는 device-local 단일 draft입니다. IndexedDB, 여러 score library, account, cloud sync는 없습니다.

## 다음에 만들 테스트 fixture

1. `chord-notehead-editing`: seconds collision, stable notehead별 임의 선택·수정·삭제·tie, range transpose, undo
2. `voices-overlap`: 한 staff의 Voice 1–4, 다른 rhythm/rest, stem·backup·overflow 격리
3. `selection-cross-system`: keyboard/mouse range, copy/paste, undo selection 복원
4. `rebar-6-8-to-3-4`: 경계 note 분할·tie와 absolute onset 보존
5. `tuplet-rational`: 3:2, 5:4, nested depth, 반복 저장 후 drift 0
6. `repeat-traversal`: volta와 D.S. al Coda, malformed cycle 진단
7. `musicxml-roundtrip`: `.mxl`, multiple voices, tuplets/directions/repeats/layout과 위치가 있는 structured loss report
8. `visual-golden`: solo, grand staff, quartet, 32-staff orchestra의 고정 font/page 결과
9. `virtual-pages`: 100 pages에서 DOM 상한, offscreen caret와 playback follow

이미 단위 회귀가 있는 G-major accidental state, 8개 meter beam/full-measure duration, measure-range key/time boundary와 전체 stream overflow 거부, 32nd/64th·겹점, transposition, grand/3-staff 생성·선택 입력, 마디 추가·안전 제거, chord 추가·마지막 tone 제거와 tie cleanup, semantic dynamic의 SVG/playback/MIDI/MusicXML export와 8단계 direction import·multi-staff/barline round-trip, primary+backup storage recovery, source-time-aware uncompressed primary-voice MusicXML import, multi-staff MusicXML/playback/MIDI는 “다음 fixture”로 다시 적지 않습니다.

## 상용 배포 전 gate

현재 package는 `private: true`인 비공개/닫힌 알파입니다. 직접·핵심 build/runtime dependency의 설치 버전, 라이선스 근거, 미해결 항목은 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)를 단일 handoff 기준으로 사용합니다. 현재 package의 SPDX 표기만으로 공개·상용 배포 준비 완료를 선언하지 않습니다.

공개·상용 web/desktop/mobile release 전에는 다음을 모두 닫아야 합니다.

1. Production client bundle의 Academico Regular/Bold, Bravura, Gonville, Petaluma, Petaluma Script **6개 font payload**는 byte·provenance·license가 확인됐고 Leland는 포함되지 않습니다. Font 관련 남은 gate는 Academico·Bravura·Petaluma 계열의 완전한 OFL text·copyright notice와 Gonville `LICENCE.txt`를 실제 배포물의 사용자가 접근 가능한 Licenses surface에 제공하는 것입니다.
2. 설치 npm artifact에 전체 license/notice가 빠진 package는 공식 upstream의 canonical text를 확보해 배포 고지에 포함합니다.
3. 실제 production artifact와 source map을 대상으로 transitive dependency·font·icon·asset SBOM/license scan을 생성하고 release record에 보관합니다.
4. Browser/server와 향후 desktop/mobile wrapper 각각에 완전한 upstream license text를 사용자가 접근 가능한 방식으로 제공합니다.
5. 새 sample library, SMuFL font, notation corpus는 code license와 별도로 content·font·음원 사용권을 승인받습니다.

## 제품 결정이 필요한 지점

- Garak 기본 shortcut을 독자 방식으로 유지할지, MuseScore/Sibelius/Finale migration profiles를 언제 넣을지
- web editor를 완전 SPA로 분리할 시점
- P0 local-first만 출시할지, account/cloud를 함께 닫힌 알파에 넣을지
- sample library를 직접 license할지, SoundFont 사용자 설치를 허용할지
- Tauri와 Electron benchmark 기준 기기/OS
- proprietary core와 선택적 LGPL Verovio adapter 배포 경계의 법률 검토
- 가격 정책: 개인 작곡가, 교육기관, 팀/출판사 중 첫 고객군

## 완료 정의

기능은 다음을 모두 통과하기 전에는 “지원”으로 표시하지 않습니다.

1. mouse와 keyboard 입력
2. edit/delete/copy 또는 해당 기능의 변경 경로
3. undo/redo와 selection 복원
4. clean engraving
5. playback semantics가 있는 기능이면 재생
6. linked score/part consistency
7. native save/load
8. MusicXML import/export 또는 명시적 loss report
9. accessibility announcement
10. unit + corpus + fresh-client browser verification
