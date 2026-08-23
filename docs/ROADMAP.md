# Garak 제품 로드맵

이 문서는 “Finale, Sibelius, MuseScore에서 기본적으로 만들 수 있는 악보를 Garak에서도 만들 수 있게 한다”는 장기 목표를 실제 개발 단위로 보존합니다. 기능이 버튼으로 존재하는 것만으로 완료 처리하지 않습니다. 입력, 편집, 사보, 재생, undo, 총보/파트, 저장, MusicXML까지 해당 의미가 보존돼야 지원 기능입니다.

## 현재 수직 슬라이스 — 2026-08-24

### 완료

- 의미 기반 Score → Part → Staff → Measure → Voice → Event 모델과 versioned native format; schema-v1은 ordered staff-measure cell마다 Voice를 정확히 1개 요구
- 생성 당시 transposition·MIDI metadata를 보존하는 instrument snapshot
- quarter note당 960 정수 tick, whole/half/quarter/eighth/16th/32nd/64th와 점 없음·한 점·겹점
- 2/4, 3/4, 4/4, 5/8, 6/8, 7/8, 9/8, 12/8의 8개 meter, 정확한 마디 용량과 기본 beam grouping
- 빈 마디를 5/8·7/8도 포함한 현재 meter의 exact whole-note fraction으로 중앙 정렬 full-measure rest 사보·MusicXML 출력
- 장·단조 각각 -7~+7 fifths 범위의 30개 concert key, 조옮김 파트의 written key projection
- 선택한 마디부터 같은 key/time 값이 이어지는 구간의 끝까지 변경하고 다음 기존 change boundary는 보존하는 range command
- meter의 1–255 정수 numerator·power-of-two denominator·exact integer-tick capacity 검증과 모든 part·staff·voice overflow 및 resulting-score tie validation 사전 거부
- 30–300 정수 BPM global tempo 편집과 첫 MusicXML `<sound tempo>` import/export 왕복
- 조표를 고려한 auto/force/hide accidental state, 옥타브·마디 경계·tie destination 회귀
- written/sounding pitch 및 Piccolo, B♭ Clarinet, F Horn, Bass Clarinet, Double Bass, Glockenspiel 변환 테스트
- 고유 catalog ID 140개와 4개 편성 template
- Piano·Harp·Celesta·Harpsichord·Accordion·Harmonium·Bandoneon grand staff, Organ 3 staff
- VexFlow 5 SVG 총보/파트 사보, grand-staff brace, 악기군 bracket, 다중 system
- 고정 마디 수가 아닌 내용·조표·박자표·viewport 기반 동적 horizontal spacing과 줄바꿈; ID→index map으로 measure마다 전체 order를 `indexOf`하던 O(n²) lookup 제거
- meter별 automatic beams, key/time change glyph, full-measure rest, system을 가로지르는 tie
- note/rest, sharp/flat/natural, 같은 part·staff·voice의 동일 written pitch를 정확히 contiguous event 사이에서만 허용하는 tie model·SVG·MusicXML·playback 병합
- Chord mode로 마지막 note event에 pitch를 추가하면서 event onset·duration을 유지하고 SVG·playback·MIDI·MusicXML `<chord/>`에 동시음 보존
- 마지막에 추가한 chord tone 하나만 immutable하게 제거하며 event ID·onset·duration·voice tick을 유지하고 해당 note ID에 연결된 tie edge만 정리
- `ppp`–`fff` 8단계 또는 None의 semantic dynamic을 선택 staff 마지막 note/rest event에 attach·replace·clear
- VexFlow `TextDynamics`, staff별로 다음 표시까지 지속되는 Web Audio·MIDI velocity, MusicXML `<direction>` dynamic export
- 악보 행 또는 Inspector에서 스태프를 선택하고 해당 스태프에 입력·삭제·tie
- overflow 없는 자동 마디 추가, 빈 마지막 마디 추가, 안전한 마지막 빈 마디 제거
- keyboard/pointer 입력과 각 past/future 방향별 최대 100 snapshot·8 MiB serialized-size proxy의 bounded undo/redo
- Web Audio playback, part mute/solo, 모든 스태프의 sounding pitch 수집, 최소 5 ms short-note gate와 시간순·동시 onset part-fair 600-note window
- 검증된 localStorage primary와 last-known-good backup을 사용하는 autosave/recovery, backup/fresh damage recovery 뒤 명시적 Save now/New까지 autosave pause, 손상 raw·quota/write 실패 보존, Garak JSON import/export
- uncompressed score-partwise `.musicxml`/`.xml`의 staff별 primary-voice subset import, part-list 순서와 `divisions`·`backup`·`forward` source cursor, 정확한 gap rest, chord/tie, 32nd/64th·겹점, 8단계 dynamic direction의 다음 event anchor·마디 경계 carry 보존
- malformed XML·내부 DTD subset/entity 선언 거부, 67,108,864 UTF-16 code unit·256 part·part당 32/전체 512 staff·20,000 measure·10,000 staff×measure cell·100,000 source element와 50,000 event/100,000 note/50,000 tie importer 상한, materialization 전 536,870,910 native tick 누적 timeline preflight
- `implicit="yes"`/non-final underfill 시간축 변화와 noncontiguous tie skip을 위치 기반 warning으로 공개하고, warning을 200개×500 code unit과 optional omission summary로 제한
- 긴 외부 source ID를 compact internal ID에 증폭하지 않고, opaque native part ID를 유일하고 참조 일관적인 안전한 MusicXML ID로 mapping
- 실제 key/time boundary, written key, dynamic direction과 multi-staff/clef/voice/staff/backup을 보존하는 MusicXML 4.0 export
- percussion clef만 GM channel 10을 사용하고 pitched percussion은 melodic으로 분류하는 MusicXML/SMF 멀티 포트 routing; port마다 melodic route 15개, pitched 240개·독립 unpitched 16개 상한과 초과 오류, [MusicXML `<midi-device>`](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/midi-device/) 1-based port와 SMF `FF 21` 0-based port 대응
- 실제 time-signature boundary, staff별 dynamic velocity, 모든 스태프를 반영하는 SMF MIDI export; VLQ 상한, 960→480 PPQ 반올림, same-port/channel/pitch overlap merge compromise를 명시
- print/PDF, 반응형 shell, 55–150% zoom, visible focus, reduced motion, dialog initial focus·background `inert`·Tab trap·Escape·focus restore
- preset 밖의 유효한 imported meter를 Inspector에 exact value와 `imported/custom`으로 표시
- 음악 도메인·MusicXML import·서버 렌더 회귀와 typecheck, lint, production build; 정확한 테스트 개수와 통과 상태는 최신 명령 출력 기준

실제 브라우저의 SVG, 조표·박자표, beam, zoom/scroll, 아이콘, bracket·spacing, console 상태는 루트 검증이 별도 증거로 확인했습니다. 실제 `.musicxml` file chooser import에서도 제목·작곡가·Violin·G major·한 마디·2-note chord가 즉시 편집 가능한 상태로 열렸고, 미지원 Voice 2는 warning modal에 정확히 한 건으로 표시됐습니다. Continue editing 뒤 G+B 사보, Chord mode의 D4 추가 후 event 1개와 `Chord · 3 notes`, 3-note playback도 확인했습니다. 이 수동 브라우저 증거는 자동 테스트와 구분합니다.

Native validator의 현재 hard ceiling은 ordered measure 20,000, part 256, 전체 staff 512, staff×measure cell/voice 10,000, event 50,000, note 100,000, tie 50,000, absolute timeline 536,870,910 tick입니다. 첫 200개 validation error 뒤에는 deterministic omission summary를 반환합니다. Base ID 256, voice ID 1,024, note/tie-reference 512, tie ID 2,048 UTF-16 code unit 상한과 part/staff/voice/event/note/tie object ID의 global uniqueness도 schema-v1 공개 계약입니다.

현재 package는 `private: true`인 비공개/닫힌 알파입니다. [라이선스 inventory와 release gate](../THIRD_PARTY_NOTICES.md)의 완전한 font/package notice 제공과 production artifact SBOM closure 전에는 공개·상용 배포 완료로 승격하지 않습니다.

### 의도적으로 제한

- Schema-v1은 staff의 measure cell마다 Voice를 정확히 1개만 허용하며 multiple voices를 저장·편집하지 않음
- Chord mode는 마지막 note event에 pitch를 추가하고 마지막에 추가한 tone을 제거할 수 있지만, 임의 notehead 선택·수정·삭제·개별 tie와 chord symbol은 미지원
- Key/time range command는 선택 마디부터 다음 기존 change boundary 직전까지만 바꾸고 resulting score가 invalid이면 원자 거부하며, overflow 음악을 재배치하는 rebar, pickup, custom meter/beam grouping은 미지원
- Dynamics 편집은 선택 staff의 시간상 마지막 event만 대상으로 하며, import도 8단계 MusicXML dynamic direction subset만 지원합니다. Hairpin/wedge, `sfz`·other/sound-only dynamic, composite 원형 의미, direction offset 보존, 임의 event 선택은 미지원
- grand staff와 Organ 3 staff는 지원하지만 각 staff의 primary voice만 편집·export
- 마지막 이벤트 기반 입력·삭제이며 stable caret/range selection과 copy/paste는 미지원
- percussion preset은 있으나 note map editor 없음
- 기본 oscillator playback이며 전문 orchestral sample이 아님
- MusicXML import는 uncompressed score-partwise `.musicxml`/`.xml`의 staff별 primary voice와 8단계 dynamic direction subset만 편집 모델로 보존; `.mxl`, multiple voices, semantic tuplets, 나머지 directions/expressions, repeats, layout round-trip과 parser depth/node budget은 미지원
- 현재 하나의 SVG에 동적 multi-system 화면 layout만 있으며 page 단위 자동/수동 break, collision avoidance, viewport virtualization, linked-part layout override 없음
- primary + last-known-good backup 복구가 있는 local device 단일 draft만 지원하며 IndexedDB, score library, account, cloud collaboration은 없음

## P0 — 닫힌 알파: 실제 곡을 끝까지 만들 수 있다

전담 2–4명 기준 대략 3–4개월, 1인 개발은 더 길게 잡습니다. 아래 1–10은 경쟁 제품의 공식 매뉴얼에서 확인한 편집 흐름과 의미 보존 요구를 Garak의 완료 기준으로 바꾼 우선순위입니다. 공식 문서는 동작 비교 근거이며 Garak의 코드나 라이선스 의존성이 아닙니다.

### 1. Chords — 현재 subset 지원, 전문 편집 확장

현재 지원 subset은 같은 staff·voice·onset·duration의 pitch를 마지막 note event에 추가합니다. 마지막에 추가한 tone은 Chord mode의 Backspace/Delete 또는 Inspector 버튼으로 하나씩 제거할 수 있으며, event와 리듬은 그대로 두고 제거된 note의 tie만 정리하므로 한 번의 snapshot undo로 복원됩니다. Keyboard와 화면 pitch button, chord 단위 stem·flag·dot, SVG, 동시 playback/MIDI, native save/load, MusicXML `<chord/>` import/export를 지원하며 fresh-browser에서 2-note imported chord에 D4를 더한 3-note chord까지 확인했습니다.

남은 P0 acceptance는 다음과 같습니다.

- stable notehead selection으로 pitch·accidental·tie를 개별 편집·삭제
- 기존 note 또는 caret onset을 대상으로 chord를 만들고 향후 MIDI에서 여러 pitch를 동시에 입력
- seconds·unison·다중 accidental과 stem 방향의 collision corpus
- range copy/paste·transpose와 linked part에서 notehead identity 보존
- chord symbol(`C7`, `Am`)은 sounding chord와 분리된 별도 semantic object로 구현

비교 기준: [MuseScore note/chord 입력](https://handbook.musescore.org/basics/entering-notes-and-rests), [MuseScore chord 선택](https://handbook.musescore.org/basics/selecting-elements).

### 2. Multiple voices

- 한 staff에 Voice 1–4를 만들고 같은 시각의 서로 다른 rhythm과 rest를 독립 보존
- voice 선택·입력·이동·삭제·undo가 다른 voice의 event를 변경하지 않음
- voice별 마디 용량 불변식과 명시적 rest 정책
- 기본 stem 방향은 Voice 1/3 up, Voice 2/4 down이며 chord·beam·accidental 충돌 회피
- playback/MIDI와 MusicXML `<voice>`/`<backup>`에서 onset 및 duration 손실 0

비교 기준: [MuseScore multiple voices](https://handbook.musescore.org/basics/working-with-multiple-voices), [Sibelius 공식 기능](https://www.avid.com/sibelius).

### 3. Selection과 caret

- stable source ID에 연결된 note-input caret이 part/staff/voice/measure/onset을 명시
- mouse와 keyboard로 단일 element, 불연속 list, 여러 measure·staff range를 생성·확장
- selection이 system/page 밖으로 이어져도 copy/cut/paste/delete/repeat paste/transpose가 정확한 대상에만 적용
- 입력·편집·undo/redo 후 caret와 selection 복원, scroll-into-view, 접근성 live announcement
- 마지막 이벤트 기반 명령을 stable target 기반 command/result API로 대체

비교 기준: [MuseScore selections](https://handbook.musescore.org/basics/selecting-elements), [Finale Selection Tool](https://usermanuals.finalemusic.com/Finale2012Win/Content/Finale/ID_MAINTOOL_UST.htm), [Sibelius Reference Guide](https://resources.avid.com/SupportFiles/Sibelius/2024.3/Sibelius_Reference.pdf).

### 4. Rebar와 measure-level key/time 확장 — range command 지원

현재는 Inspector에서 시작 마디를 선택해 key 또는 time을 그 값의 다음 기존 change boundary 직전까지 한 번에 바꿉니다. 뒤의 change는 보존되고, SVG와 MusicXML은 실제 key/time boundary를, MIDI는 실제 time-signature boundary를 출력합니다. Meter는 numerator 1–255, power-of-two denominator, exact integer-tick capacity만 허용하며 영향 구간의 모든 part·staff·voice를 먼저 검사한 뒤 resulting score validator를 실행합니다. 어느 voice든 새 capacity를 넘거나 measure start 이동이 strict tie adjacency를 깨면 원본 score를 그대로 반환해 부분 변경이나 암묵적 rebar가 일어나지 않습니다. Preset 밖의 유효한 imported meter는 Inspector에서 exact `imported/custom` 값으로 보이지만 새 임의 meter를 저작하는 별도 UI는 아직 없습니다.

남은 P0 acceptance는 다음과 같습니다.

- time change 뒤 음악을 새 capacity로 rebar하되 sounding order, absolute duration, pitch, staff, voice, tie를 보존
- 경계를 넘는 note는 필요 시 분할하고 tie로 연결하며 전체 작업을 한 번에 undo
- pickup과 insert/delete measure가 같은 command 계층·capacity 불변식을 사용
- 사용자가 지정하는 compound/additive meter grouping과 그에 따른 beam 재계산
- 명시적인 boundary 삭제·병합과 key cancellation/courtesy 정책을 stable selection에서 편집

비교 기준: [MuseScore time signatures와 rebar](https://handbook.musescore.org/notation/rhythm-meter-and-measures/time-signatures), [MuseScore key signatures](https://handbook.musescore.org/notation/pitch/key-signatures), [MuseScore measure 추가·삭제](https://handbook.musescore.org/basics/adding-and-removing-measures).

### 5. Tuplets

- 시간을 정규화된 Rational로 승격하고 `actual:normal`, parent span, 내부 event를 canonical하게 저장
- 우선 2–9 divisions와 3:2 triplet을 입력하며 내부 duration 합이 parent span과 정확히 일치
- number/ratio/hidden 및 bracket auto/show/hide, beam과 stem 방향을 사보
- selection, copy/paste, playback, native, MusicXML에서 비율과 onset drift 0
- nested tuplet은 같은 불변식으로 확장하고 depth/복잡도 제한을 둠

비교 기준: [MuseScore tuplets](https://handbook.musescore.org/notation/rhythm-meter-and-measures/tuplets), [Finale Tuplets](https://usermanuals.finalemusic.com/FinaleWin/Content/Finale/Tuplets.htm).

### 6. Expressions — semantic dynamics subset 지원

현재 `ppp`, `pp`, `p`, `mp`, `mf`, `f`, `ff`, `fff` 또는 None은 선택 staff의 시간상 마지막 note/rest event에 semantic value로 attach·replace·clear할 수 있습니다. SVG는 `TextDynamics`를 사용하고, playback과 MIDI는 해당 staff에서 다음 dynamic까지 velocity를 지속하며, MusicXML은 staff·voice가 있는 `<direction>`과 `<sound dynamics>`로 export합니다. Uncompressed score-partwise import는 같은 8단계 `<direction-type><dynamics>`를 지정 staff·선택 primary voice의 다음 표현 가능한 event에 붙이고 마디 경계를 넘어 carry합니다. Offset은 cursor를 움직이지 않고 무시해 warning을 내며 above placement는 below로 정규화해 warning을 냅니다.

남은 P0 acceptance는 다음과 같습니다.

- 임의 event 또는 staff/system time position을 선택해 dynamic을 이동·삭제하고 rebar/reflow 뒤 anchor 보존
- Imported direction의 editable offset·placement 보존과 임의 event/time-position 재지정
- hairpin/wedge span, `sfz`·other dynamic과 composite 원형 의미, hairpin interpolation을 semantic하게 저장·사보·재생
- articulation, expression text, tempo text, rehearsal mark를 semantic subtype으로 추가
- keyboard/palette 입력, selection·undo, 총보/파트 보존과 기본 collision avoidance

비교 기준: [MuseScore expressive markings](https://handbook.musescore.org/notation/expressive-markings), [MuseScore dynamics와 hairpins](https://handbook.musescore.org/notation/expressive-markings/dynamics), [Finale Expressions](https://usermanuals.finalemusic.com/FinaleWin/Content/Finale/Expressions.htm).

### 7. Repeats

- start/end repeat barline과 play count, volta 1/2, D.C., D.S., Segno, Coda, To Coda, Fine 모델·입력·사보
- repeat graph를 결정론적으로 순회하고 malformed cycle에는 상한과 진단 제공
- playback, playhead, MIDI/offline render가 같은 traversal 사용
- key/time/courtesy와 multimeasure rest 경계가 repeat에서 올바르게 분리
- native와 MusicXML에서 barline, ending, direction, target 의미 보존

비교 기준: [MuseScore repeat signs](https://handbook.musescore.org/notation/repeats/repeat-signs), [MuseScore repeats](https://handbook.musescore.org/notation/repeats), [Finale linked-parts repeat 의미](https://usermanuals.finalemusic.com/FinaleWin/Content/Finale/Linked_Parts.htm).

### 8. Linked-part layout

- full score와 part view가 note/rest/voice/expression 등 하나의 음악 데이터를 공유하고 양쪽 편집이 즉시 반영
- part별 instrument/voice visibility, name, multimeasure rest, cue 기본 정책
- page size, margin, staff/system spacing, page/system break, text offset은 part별 layout override로 분리
- part layout 변경이 총보 음악·layout을 오염시키지 않고 총보 변경이 음악 의미에는 반영
- 선택 파트 및 전체 파트 batch PDF/MusicXML 출력

비교 기준: [MuseScore Parts](https://handbook.musescore.org/basics/parts), [Finale Linked Parts](https://usermanuals.finalemusic.com/FinaleWin/Content/Finale/Linked_Parts.htm).

### 9. MusicXML import — uncompressed primary-voice subset 지원, round-trip 확장

현재는 file chooser에서 uncompressed score-partwise `.musicxml`/`.xml`을 열어 metadata, 첫 유효한 30–300 BPM global tempo, part/instrument, multi-staff, clef/key/time, staff별 선택 primary-voice note/rest/chord/tie와 32nd/64th·겹점을 편집·재생·재-export할 수 있습니다. Voice 1을 우선하고 없으면 처음 나타난 voice 하나만 선택합니다. 지원되는 8단계 dynamic direction은 staff·선택 primary voice의 다음 표현 가능한 event에 붙고, pending mark는 마디 경계를 넘어 carry합니다. Part-list 순서와 measure source cursor를 따르며 `divisions` 변경, `backup`, `forward`를 반영하고, 표현 가능한 leading gap은 정확한 rest로 materialize합니다. Overlap·마디 초과·표현 불가능 duration·선택되지 않은 voice는 조용히 재배치하지 않고 score 위치가 포함된 warning으로 보고합니다. `implicit="yes"`와 non-final underfill로 pickup/source timeline을 보존하지 못하는 경우 지연 tick을 공개하며, 정규화 뒤 noncontiguous가 된 tie는 건너뜁니다.

보안·리소스 경계로 malformed XML과 내부 DTD subset/entity 선언을 거부합니다. UI file chooser는 10 MiB입니다. Importer core 상한은 67,108,864 UTF-16 code unit, part 256, part당 staff 32, 전체 staff 512, measure 20,000, staff×measure cell 10,000, source measure child element 100,000, materialized event 50,000/note 100,000/tie 50,000입니다. 누적 full-meter capacity도 materialization 전에 계산해 native absolute timeline 상한 536,870,910 tick을 넘으면 거부합니다. Source ID 256, imported name 200, short name 80, rights 500 code unit 제한을 적용하고 긴 source ID를 descendant ID에 복사하지 않습니다. Warning은 중복 제거된 visible 200개, 각 500 code unit과 optional omission summary로 UI를 제한합니다. Part-list/document의 누락·중복·깨진 reference와 안전하지 않은 duration도 오류 또는 warning으로 처리합니다.

남은 P0 acceptance는 다음과 같습니다.

- compressed `.mxl`과 zip size/file-count/path/depth/uncompressed-size 제한
- multiple voices, tuplets, 8단계 dynamic subset 밖의 directions/expressions, repeats, system/page break와 layout intent
- 이미 차단한 내부 DTD/entity의 변형 회귀에 더해 external DTD system/public identifier, parser depth/node budget, entity expansion·numeric fuzz corpus
- warning에 element type과 score 위치를 일관되게 기록
- import→export→import 후 pitch/onset/duration/staff/voice/tie/tuplet/repeat 의미 동일
- 30개 이상 합법적 golden score corpus와 외부 앱 compatibility

비교 기준: [MuseScore MusicXML 작업](https://handbook.musescore.org/file-management/working-with-musicxml-files), [Finale MusicXML import](https://usermanuals.finalemusic.com/FinaleWin/Content/Finale/sub-import.htm).

### 10. Pagination과 viewport virtualization

이 항목은 경쟁 앱 기능 표가 아니라 Garak의 측정 가능한 기술 acceptance입니다.

- page size/orientation/margin/staff size/system spacing과 automatic/manual system·page break
- 동일 score·font·page 설정에서 결정적인 system/page 경계, 화면과 PDF/print 일치
- page/system별 SVG와 source ID → glyph/bbox/hit-region mapping
- viewport 주변과 작은 overscan만 mount하고 offscreen page 수에 무관한 DOM 상한 유지
- unmounted page를 가로지르는 selection, caret, playback follow, undo 정확성
- 32 staff × 200 measures 입력 p95 80ms 이하; 100-page·40-staff fixture에서 initial usable 2초 이하와 scroll frame p95 20ms 이하

비교 개념: [MuseScore page layout](https://handbook.musescore.org/formatting/page-layout-concepts), [MuseScore pages와 vertical spacing](https://handbook.musescore.org/formatting/pages-and-vertical-spacing).

### 병렬 P0 기반 작업

- command processor: changed IDs, affected measures, selection before/after, transaction undo
- grace notes, tie/slur curve fitting, ottava·pedal·breath·fermata
- versioned instrument catalog data package, localized long/short names, score order, range warnings
- concert/transposed pitch view와 instrument change/doubling
- unpitched percussion map과 basic cue note
- 현재 primary + last-known-good localStorage 계약을 유지한 IndexedDB 전환, multi-score library, schema migration, quota/eviction·persistent-storage UI
- tempo map, metronome, start position, loop, volume/pan/mute/solo mixer
- lazy-loaded sample fallback와 polyphony cap
- score composite keyboard navigation, part/staff/measure/beat/voice/event announcement
- high contrast, 200% zoom, reduced motion, VoiceOver/NVDA 수동 시나리오
- 확인된 production font payload 6개의 완전한 license text를 사용자가 접근 가능한 Licenses surface에 제공하고, 향후 self-hosted SMuFL 1.4 Bravura와 SVG/PDF/PNG 출력 검증

### P0 합격 기준

- 30개 golden score에서 glyph 잘림 0
- 지원 서브셋 MusicXML 왕복 후 pitch/rhythm/part/staff/voice/meter/key 손실 0
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
