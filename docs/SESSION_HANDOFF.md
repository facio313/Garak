# 다음 세션 이어하기

마지막 갱신: 2026-08-24 KST

이 문서는 “더 필요한 것이 있으면 기억해두고 나중에 계속”이라는 요청을 위해 유지하는 살아 있는 handoff입니다.

## 현재 공개 결과

- `/`에서 Garak 알파 편집기가 실행됩니다.
- 첫 방문은 Chamber orchestra 예제 score를 보여줍니다.
- New에서 Solo, String quartet, Chamber orchestra, Symphony orchestra를 선택할 수 있습니다.
- Score와 Part는 같은 ScoreDocument를 읽습니다.
- VexFlow SVG가 모든 현재 part와 모든 measure system을 렌더합니다.
- 입력, tie, undo/redo, playback, local autosave, native/MusicXML/MIDI export가 연결돼 있습니다.
- `public/og.png`에는 검증된 Garak social card가 있습니다.

## 다음 작업 시작 순서

다음 세션은 아래 순서를 바꾸지 않는 것이 좋습니다.

1. `npm install`
2. `npm run typecheck && npm run lint && npm run test:unit`
3. `npm run dev`
4. 현재 score 화면에서 수동 smoke:
   - String quartet 새로 만들기
   - Violin I 선택
   - `3 C D E R` 입력
   - `Cmd+Z`, `Cmd+Shift+Z`
   - 같은 pitch 두 번 입력 후 `T`
   - Space playback
   - Score/Part 전환
   - JSON, MusicXML, MIDI export
   - 새로고침 후 복구
5. 실패가 없다면 아래 P0 첫 묶음으로 진행

## 가장 먼저 구현할 P0 묶음

### A. command core 추출

- UI의 `commit`, `appendEvent`, `removeLastEvent`, `toggleTieLastTwo`를 `lib/music/commands` reducer로 이동
- command result가 changed IDs, affected measures, selection before/after를 반환
- keyboard map을 CommandId adapter로 분리
- undo branch, invalid no-op, original ID restoration tests

### B. Rational time과 meter/key UI

- duration/onset을 Rational로 승격
- 3/4, 6/8, pickup
- staff별 written key/clef attributes
- concert key → transposing part written key projection
- G major accidental-state fixture
- 6/8 dotted-quarter + 3 eighths fixture

### C. chords와 voices

- NoteEvent.notes 여러 pitch 허용
- Voice 1–4 UI와 자동 stem 방향
- voice별 overflow validator
- VexFlow beam/voice formatting adapter
- selection과 delete를 “마지막 이벤트”가 아닌 stable event ID 기반으로 변경

### D. durable local storage

- localStorage에서 IndexedDB로 이동
- primary + previous-good snapshot
- write 후 parse/validate read-back
- quota/eviction/persistent-storage 안내
- schema migration runner

### E. MusicXML import

- safe XML parser, DTD/external entity off
- partwise 기본 subset
- parts, measures, voices, note/rest/dot/tie/time/key/clef/transpose
- unsupported element loss report
- native→MusicXML→native canonical comparison

## 알려진 제한과 기술 부채

- initial example score는 시각 확인을 위해 각 part 첫 마디에 motif가 있고, New로 만든 score는 빈 악보로 시작합니다.
- Piano/Harp/Organ은 catalog에는 있으나 UI가 아직 한 staff만 생성합니다.
- global key/time metadata가 part별 written key를 완전히 표현하지 못합니다. P0-B에서 staff attributes로 이동합니다.
- playback은 oscillator fallback이고 실제 GM program별 sample을 사용하지 않습니다.
- tie chain은 playback/MIDI에서 하나의 지속음으로 합쳐집니다. 이후 articulation과 pedal을 더해도 이 불변식을 유지해야 합니다.
- MIDI melodic channel은 15개 이후 재사용됩니다. multi-port policy가 필요합니다.
- MusicXML export는 현재 지원 subset만 단방향으로 생성하며 XSD/외부 앱 compatibility corpus가 아직 없습니다.
- 전체 score를 한 번에 SVG로 그립니다. 32 staff × 수백 measure 전에 system virtualization이 필요합니다.
- zoom은 현재 engraving frame 폭을 조절합니다. 실제 glyph scale과 page reflow 모드를 분리해야 합니다.
- playhead는 시간 진행을 보여주지만 정확한 event bbox를 따라가지 않습니다. DisplayList source ID mapping 후 수정합니다.
- localStorage는 device-local 단일 draft입니다. 여러 score library, account, cloud sync는 없습니다.

## 다음에 만들 테스트 fixture

1. `accidental-g-major`: F♮, F♮, F♯, rest / next-measure F♯
2. `compound-6-8`: dotted quarter + eighth + eighth + eighth, overflow reject
3. `transposition`: written C4 → Piccolo72, B♭ Clarinet58, F Horn53, Bass Clarinet46, Double Bass48, Glock84
4. `undo-branch`: C, D, rest, undo×2, redo, E, redo disabled
5. `load-safety`: duplicate IDs, missing measure, dangling tie, future schema, overflow, valid incomplete draft
6. `orchestra-template`: standard order, numbering, shared measure IDs, JSON round-trip
7. `musicxml-roundtrip`: all supported primitives and explicit loss report
8. `visual-golden`: solo, quartet, 32-staff orchestra at fixed fonts/page width

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
3. undo/redo
4. clean engraving
5. playback semantics가 있는 기능이면 재생
6. linked score/part consistency
7. native save/load
8. MusicXML import/export 또는 명시적 loss report
9. accessibility announcement
10. unit + corpus + fresh-client verification
