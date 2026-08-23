# Garak 상용 아키텍처 결정 기록

기준일: 2026-08-24

## 1. 결론

Garak의 상용 기술 방향은 “독립적인 의미 모델 + 명령 계층 + 교체 가능한 사보/재생/파일 어댑터”입니다.

현재 수직 슬라이스는 React 19, TypeScript, vinext/Vite, VexFlow 5, Web Audio, localStorage를 사용합니다. Sites 배포 구조상 vinext를 사용하지만 음악 코어는 React와 Cloudflare에 의존하지 않습니다. 제품이 커지면 편집기 SPA, 마케팅/계정 웹, 동기화 서버, export worker를 별도 앱으로 나눌 수 있습니다.

장기 권장 조합은 다음과 같습니다.

- 편집 UI: React + TypeScript + Vite 기반 SPA/PWA
- 내부 원본: 독자 `ScoreModel` 및 schema migration
- 편집: 모든 입력을 통과시키는 domain command processor
- 초기 사보: VexFlow 5 SVG adapter
- 전문 출력 후보: 자체 layout engine, 선택적으로 Verovio/MEI 검증 adapter
- 화면 글리프: SMuFL 1.4 및 self-hosted Bravura
- 재생 MVP: Web Audio, 이후 Tone.js/Sampler 또는 AudioWorklet
- 로컬 내구성: localStorage 수직 슬라이스 → IndexedDB + recovery snapshots
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
 │           └─ Voice[]
 │               └─ NoteEvent | RestEvent
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

현재 지원 서브셋은 quarter note당 960 tick으로 정수 계산합니다. 온·2·4·8·16분과 한 점음표가 정확합니다. Tuplet, polymeter, cadenza를 추가하기 전에 코어 시간을 정규화된 `Rational { numerator, denominator }`로 승격합니다. JavaScript float를 canonical duration이나 onset으로 저장하지 않습니다.

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
- 한 system에 최대 4마디를 두고, 마디가 늘면 system을 추가합니다.
- 총보와 파트는 같은 ScoreDocument를 읽습니다.
- selection과 playhead는 악보 SVG와 분리된 overlay입니다.

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
| [OpenSheetMusicDisplay](https://github.com/opensheetmusicdisplay/opensheetmusicdisplay) | MusicXML 읽기/표시 | BSD-3-Clause | 핵심 편집 모델로 사용하지 않음 |
| [Verovio](https://github.com/rism-digital/verovio) | MEI/WASM/SVG/출력 | LGPLv3 | 별도 Worker adapter 및 품질 비교 후보 |
| [abcjs](https://github.com/paulrosen/abcjs) | ABC→SVG/재생 | MIT | quick-entry/리드시트 후보 |
| [MuseScore Studio](https://github.com/musescore/MuseScore) | 완전한 데스크톱 악보 앱 | GPLv3 | 독점 클라이언트에 임베드하지 않고 QA 참조 |
| [Tone.js](https://github.com/Tonejs/Tone.js) | Web Audio scheduler/synth | MIT | P0 이후 sampler/playback adapter 후보 |
| [Yjs](https://github.com/yjs/yjs) | CRDT/offline sync | MIT | 모델 안정 후 협업 계층 후보 |

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

### MusicXML 4.0

[MusicXML 4.0](https://www.w3.org/2021/06/musicxml40/)은 주 교환 포맷입니다. native 원본으로 사용하지 않습니다. import 시 미지원 요소 loss report, MXL zip bomb/path traversal 방지, XML entity 비활성화, depth/node/file-size 제한이 필요합니다.

### MIDI

MIDI는 연주 데이터입니다. enharmonic spelling, staff, voice, beam, layout을 잃으므로 저장 원본이 될 수 없습니다. Export는 written pitch가 아닌 sounding pitch와 tempo map을 사용합니다. Import는 quantization, voice separation, sustain, tuplet 추론을 가진 별도 제품 기능입니다.

### MEI/ABC

MEI는 학술·고음악·비평판과 Verovio 연동의 보조 포맷, ABC는 리드시트와 빠른 텍스트 입력 포맷으로 둡니다.

## 7. 저장과 협업

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
