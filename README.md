# Garak Studio

Garak은 브라우저에서 솔로, 앙상블, 오케스트라 악보를 빠르게 작성하기 위한 웹 악보 편집기입니다. 현재 저장소는 단순 화면 시안이 아니라, 의미 기반 악보 모델과 실제 SVG 사보, 스태프별 음표 입력, 재생, 저장, 내보내기를 한 흐름으로 연결한 알파 버전입니다.

## 지금 할 수 있는 일

- Solo, String quartet, Chamber orchestra, Symphony orchestra 템플릿으로 새 악보 만들기
- 고유 ID를 가진 140개 관현악·건반·성악 악기 preset 검색 및 파트 추가/삭제
- treble, alto, tenor, bass, percussion clef를 VexFlow 5 SVG로 사보
- Piano, Harp, Celesta, Harpsichord, Accordion, Harmonium, Bandoneon의 grand staff와 Organ의 3-staff 생성·표시
- 멀티 스태프 악보를 클릭하거나 Inspector에서 스태프를 선택한 뒤 해당 스태프에 입력·삭제·붙임줄 적용
- 온음표부터 64분음표까지 7개 음가와 점 없음·한 점·겹점 입력
- 음표·쉼표·샵·플랫·내추럴 및 동일음 붙임줄 입력
- Chord mode에서 마지막 note event의 onset·duration을 유지하며 pitch를 추가하고, 마지막에 추가한 tone만 안전하게 제거해 event·리듬을 보존하면서 관련 tie 정리
- Chord의 모든 tone을 SVG·재생·MIDI·MusicXML에 같은 onset과 duration으로 보존
- 장·단조 각각 -7~+7 fifths 범위의 30개 concert key 선택, 조옮김 악기의 written key 표시·사보·MusicXML 출력
- 2/4, 3/4, 4/4, 5/8, 6/8, 7/8, 9/8, 12/8의 8개 meter 선택과 정확한 마디 용량 검증; preset 밖의 유효한 imported meter도 Inspector에서 현재 값으로 표시
- Inspector에서 시작 마디를 골라 key 또는 meter를 다음 기존 change boundary 직전까지 변경하고 이후 change는 보존
- Meter command의 1–255 정수 numerator, power-of-two denominator, exact integer-tick capacity gate와 모든 part·staff·voice overflow 및 resulting-score tie 불변식 사전 검증
- 30–300 범위의 정수 global tempo 편집과 MusicXML initial tempo import/export 왕복
- `ppp`–`fff` 8단계 semantic dynamic을 선택 staff의 마지막 note/rest event에 attach·replace·clear하고 VexFlow `TextDynamics`로 사보
- Dynamic이 다음 표시까지 staff별로 지속되는 Web Audio·MIDI velocity와 MusicXML `<direction>` export
- meter에 맞는 기본 beam group, 5/8·7/8 같은 meter도 whole-note fraction으로 정확히 보존하는 중앙 정렬 full-measure rest
- 음표 수, 점, 임시표, 조표·박자표 폭과 viewport를 반영하고 measure ID→index map으로 반복 `indexOf` 조회를 없앤 동적 마디 간격 및 system 줄바꿈
- 마지막에 빈 마디 추가, 비어 있고 tie가 연결되지 않은 마지막 마디 제거, 마디가 가득 차면 자동 추가
- 키보드와 화면 툴바를 병행한 빠른 입력
- 100개 snapshot과 직렬화 추정치 8 MiB 중 먼저 닿는 한도로 과거/미래를 잘라내는 undo/redo
- 총보와 선택 파트 보기 전환, grand staff brace와 악기군 bracket
- 파트별 mute/solo와 written→sounding pitch를 반영하고 짧은 음의 gate를 보존하는 전체 스태프 Web Audio 재생; 한 번에 600음까지 시간순·동시 onset의 part 간 공정 선택
- versioned Garak JSON의 검증된 primary + last-known-good backup 자동 저장, primary 손상 시 backup 복구와 명시적 Save now/New 전 autosave 일시정지, corruption·quota/write 실패 status, 파일 다운로드·업로드
- uncompressed score-partwise `.musicxml`/`.xml`의 staff별 primary-voice subset import, source `divisions`·`backup`·`forward` 시간축과 정확한 gap rest, 8단계 dynamic direction의 다음 event anchor·마디 경계 carry 보존, 미지원 요소 warning modal
- MusicXML import의 well-formedness·내부 DTD/entity 차단과 XML 길이·part·staff·measure 리소스 상한
- key/time과 dynamic 경계를 보존하는 멀티 스태프 MusicXML 4.0, meter change·dynamic velocity·멀티 포트 악기 routing을 보존하는 전체 스태프 Standard MIDI File, 인쇄/PDF 내보내기
- 마디 수가 늘어날수록 동적으로 여러 system으로 이어지는 악보
- 55–150% zoom, 데스크톱·축소 화면·인쇄 전용 레이아웃
- modal을 열 때 dialog focus, 배경 `inert`, Tab focus trap, Escape 닫기와 이전 focus 복원

## 빠른 실행

Node.js 22.13 이상이 필요합니다.

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:3000`을 엽니다.

## 검증 명령

```bash
npm run typecheck
npm run lint
npm run test:unit
npm test
```

현재 테스트 개수와 통과 여부는 위 명령의 최신 출력이 기준입니다. `npm test`는 프로덕션 빌드를 새로 만들고 음악 코어·MusicXML import·실제 서버 렌더 회귀를 함께 실행합니다. 실제 브라우저의 SVG 배치, file chooser import, zoom/scroll, console 오류 확인은 별도 수동 회귀 증거로 관리하며 자동 테스트 개수에 합산하지 않습니다.

## 키보드 입력

악보에서 입력할 스태프를 선택한 뒤 다음 단축키를 사용할 수 있습니다.

| 키 | 동작 |
|---|---|
| `A`–`G` | 현재 옥타브·임시표·음가로 선택 스태프에 음표 입력 |
| Chord mode + `A`–`G` | 선택 스태프의 마지막 note event에 pitch 추가 |
| `R` | 현재 음가의 쉼표 입력 |
| `1`–`7` | 온음표 → 64분음표 선택 |
| `.` | 점 없음 → 한 점 → 겹점 → 점 없음 순환 |
| `T` | 선택 스태프의 마지막 두 동일음 붙임줄 토글 |
| `↑` / `↓` | 입력 옥타브 변경 |
| `Backspace` / `Delete` | normal mode에서는 선택 스태프의 마지막 이벤트 삭제 |
| Chord mode + `Backspace` / `Delete` | 마지막 chord tone 하나만 제거; 한 tone은 유지 |
| `Space` | 재생/정지 |
| `Cmd/Ctrl+Z` | 실행 취소 |
| `Cmd/Ctrl+Shift+Z` | 다시 실행 |
| `Cmd/Ctrl+S` | 로컬 저장 |
| `Cmd/Ctrl+P` | 인쇄/PDF |
| `?` | 전체 단축키 도움말 |

텍스트 입력, 선택 상자, 일반 버튼에 포커스가 있거나 한국어 IME 조합 중에는 음악 입력 단축키가 작동하지 않습니다.

## 핵심 구조

```text
컴퓨터 키보드 / 마우스 / 향후 MIDI·터치
                  ↓
             편집 명령 계층
                  ↓
  framework-independent ScoreDocument V1
  Score → Part → Staff → Measure → Voice → Event
        ↙              ↓               ↘
  VexFlow SVG     Playback plan      Codec ports
     화면            Web Audio       Garak/MusicXML/MIDI
```

악보의 원본은 화면 좌표나 VexFlow 객체가 아닙니다. 기보음, 음가, 성부, 파트, 스태프, 악기 조옮김을 보존하는 자체 `ScoreDocument`가 원본이며 화면·재생·내보내기는 모두 같은 모델을 읽습니다. 악기 파트에는 catalog ID뿐 아니라 생성 당시 transposition과 MIDI metadata snapshot을 저장해, 카탈로그 수정이 기존 악보의 소리를 바꾸지 않게 했습니다.

리듬은 quarter note당 960의 정수 tick으로 계산합니다. 온음표부터 64분음표까지와 점 없음·한 점·겹점, 8개 meter의 마디 길이는 반올림 없이 표현하며, 향후에는 같은 공개 API 뒤에서 유리수 기반 tuplet 모델로 확장합니다.

## 저장소 구조

```text
app/                    앱 진입점, 전역 스타일, 메타데이터
components/             편집기 UI와 교체 가능한 VexFlow 렌더러
lib/music/              음악 모델, 악기 카탈로그, 명령, export, playback plan
tests/                  도메인 불변식과 실제 서버 렌더 검증
docs/ARCHITECTURE.md     상용화를 고려한 장기 기술 설계
docs/ROADMAP.md          Finale/Sibelius/MuseScore급 확장 로드맵
docs/SESSION_HANDOFF.md  다음 작업자가 즉시 이어갈 체크리스트
THIRD_PARTY_NOTICES.md   배포 라이선스 inventory와 미해결 release gate
```

## 현재 알파의 명확한 경계

Schema-v1은 각 staff의 각 measure cell에 편집 Voice를 정확히 1개만 허용합니다. Importer는 staff마다 Voice 1을 우선하고, 없으면 처음 나타난 voice 하나만 선택하며 나머지는 warning과 함께 건너뜁니다. Chord mode는 마지막 note event에 pitch를 추가하고 마지막에 추가한 tone을 제거하는 subset을 지원합니다. 제거는 event ID·onset·duration·voice tick을 유지하고 해당 tone의 tie만 정리하지만, 임의 notehead 선택·수정·삭제·개별 tie와 chord symbol은 아직 없습니다.

Tie는 같은 written pitch, 같은 part·staff·voice의 source와 destination을 잇고 destination event의 start tick이 source event의 end tick과 정확히 같아야 합니다. Note마다 incoming/outgoing tie는 각각 최대 하나이며 cycle을 허용하지 않습니다. 저장 데이터 validator는 이 규칙을 거부 기준으로 사용하고, MusicXML importer는 pickup/underfill 정규화 뒤 연속하지 않게 된 tie를 warning과 함께 건너뜁니다.

Key/time은 선택 마디부터 해당 속성의 다음 기존 change boundary 직전까지만 바꿀 수 있습니다. SVG와 MusicXML은 실제 key/time boundary를, MIDI는 실제 time-signature boundary를 보존합니다. Meter 변경은 overflow뿐 아니라 resulting score 전체 validation까지 통과해야 하므로 tie의 절대 연속성을 깨면 원자적으로 원본을 반환합니다. 음악을 새 마디에 재배치하는 rebar, pickup, custom beam grouping은 아직 없습니다. 유효한 imported custom meter는 정확한 값과 `imported/custom` 표기로 Inspector에 남지만 preset selector가 임의 meter 저작 UI를 제공하는 것은 아닙니다.

Tempo는 schema와 UI 모두 정수 30–300 BPM입니다. MusicXML importer는 첫 번째 유효한 `<sound tempo>`를 반올림해 global tempo로 사용하고 이후 tempo change는 warning으로 남기며, exporter는 첫 마디에 metronome과 `<sound tempo>`를 함께 기록합니다. 따라서 Garak이 내보낸 이 initial/global tempo subset은 다시 가져올 수 있지만 tempo map이나 중간 tempo 편집은 아직 없습니다.

Dynamics는 `ppp`, `pp`, `p`, `mp`, `mf`, `f`, `ff`, `fff` 또는 None을 선택 staff의 시간상 마지막 note/rest event에만 attach·replace·clear하는 subset입니다. SVG, staff별 지속 playback/MIDI velocity, MusicXML direction export를 지원합니다. Uncompressed score-partwise MusicXML import는 같은 8단계 `<direction-type><dynamics>`를 지정 staff·선택 primary voice의 다음 표현 가능한 note/rest event에 붙이고 마디를 넘어 carry합니다. Direction offset은 cursor를 움직이지 않고 무시하며 warning을 내고, above placement는 below로 정규화해 warning을 냅니다. Hairpin/wedge, `sfz`·other dynamic, sound-only dynamic, 비선택 voice, words/other direction과 임의 event 선택은 아직 지원하지 않습니다. 지원 mark가 여러 개인 composite는 원형을 보존하지 않고 warning과 함께 마지막 mark로 정규화합니다.

MusicXML import는 uncompressed score-partwise `.musicxml`/`.xml`에서 part-list 순서, measure별 `divisions`, `backup`/`forward`, staff별 선택 primary voice, chord/tie, 32·64분음표와 겹점, 위 8단계 dynamic direction subset을 처리합니다. 표현 가능한 시간축 gap은 rest로 채우고 overlap·마디 초과·표현 불가능 duration은 위치가 포함된 warning과 함께 건너뜁니다. `implicit="yes"`는 pickup metadata를 보존하지 못하고 explicit measure로 export된다고 알리며, 마지막이 아닌 underfilled source measure는 full active meter로 확장되어 다음 마디가 늦어지는 tick 차이를 알립니다. Warning은 중복 제거된 200개(각 500 UTF-16 code unit 이하)와 필요할 때 omission summary 1개로 제한합니다.

UI file chooser는 10 MiB, importer core는 67,108,864 UTF-16 code unit, 256 part, part당 32 staff, 전체 512 staff, 20,000 measure, 10,000 staff×measure cell, source measure child element 100,000개를 상한으로 둡니다. Materialize 결과도 event 50,000개, note 100,000개, tie 50,000개를 넘지 못하며, 누적 full-meter timeline은 materialization 전에 native 상한 536,870,910 tick을 preflight합니다. 외부 source ID는 256 code unit으로 제한하고 내부 descendant ID에는 복제하지 않으며, MusicXML export는 opaque part ID를 유일하고 참조가 일치하는 안전한 XML ID로 바꿉니다. Native validator도 ordered measure 20,000, part 256, 전체 staff 512, staff×measure cell/voice 10,000, event 50,000, note 100,000, tie 50,000 및 absolute timeline 536,870,910 tick을 상한으로 둡니다. 첫 200개 validation error 뒤에는 omission summary만 반환합니다.

Malformed XML과 내부 DTD subset/entity 선언은 거부합니다. `.mxl`, multiple voices의 동시 편집, semantic tuplets, dynamic subset 밖의 directions/expressions, repeats, layout round-trip과 parser depth/node budget은 아직 지원하지 않습니다. 작곡 기능에서도 stable caret/range selection, copy/paste, grace note, articulation·hairpin·임의 expression, repeat/volta/jump, linked-part 전용 layout, 전문 pagination/virtualization, percussion map editor, 고품질 오케스트라 음원, 클라우드 협업이 남아 있습니다. 구현되지 않은 기능을 작동하는 것처럼 표시하지 않습니다.

Live playback은 note duration의 90%를 gate로 쓰되 최소 5 ms를 보장하고 attack을 18 ms 또는 duration의 35% 중 작은 값으로 제한합니다. 600음을 넘는 score는 가장 이른 onset부터 선택하고 한 onset 자체가 한도를 넘으면 part별 round-robin으로 채웁니다. MIDI export는 native 960 PPQ를 480 PPQ로 반올림 quantize하고 note-off를 최소 1 tick 뒤에 둡니다. VLQ는 `0x0FFFFFFF`까지이며, 같은 port/channel/pitch의 겹친 note ownership은 긴 구간으로 합쳐 later reattack을 버리고 최초 velocity를 유지합니다(같은 onset이면 큰 velocity). 이는 SMF note-off 모호성을 피하기 위한 명시적 손실입니다.

MIDI/MusicXML routing은 instrument family가 아니라 clef를 기준으로 하며, percussion clef만 GM channel 10에 배치하고 timpani·glockenspiel 같은 pitched percussion은 melodic route를 사용합니다. 각 port는 channel 10을 제외한 15개 melodic route를 제공하고, MusicXML `<midi-device port>`는 1–16, SMF `FF 21` port meta event는 같은 port를 0–15로 기록합니다. Export 상한은 고유 pitched route 240개와 독립 unpitched-percussion part 16개이며, 초과하면 명시적으로 오류를 반환합니다.

브라우저 저장은 기존 `garak.score.v1` primary key와 `.backup` last-known-good snapshot을 사용합니다. Load 자체는 아무것도 쓰지 않습니다. Primary가 깨졌거나 읽히지 않아 backup을 열거나 두 snapshot 모두 손상되어 fresh score를 열면 damaged raw를 덮어쓰지 않도록 autosave를 멈추며, 사용자가 Save now 또는 New를 명시적으로 실행해야 다시 활성화합니다. 저장 전 score validation, 변경 없는 저장의 no-op, 유효한 이전 primary의 backup 선행 기록 후 새 primary 기록을 적용하고 quota·접근·직렬화·validation 실패는 성공처럼 표시하지 않습니다. Undo/redo의 각 방향은 현재 쪽 snapshot을 보존하면서 최대 100개와 8 MiB 추정 serialized byte budget을 적용하고, 단일 snapshot 자체가 예산보다 커도 최소 1개는 유지합니다. IndexedDB, 여러 score library, 계정·cloud sync는 아직 없습니다.

전체 제품 설계와 단계별 완료 기준은 [아키텍처](docs/ARCHITECTURE.md)와 [로드맵](docs/ROADMAP.md)을 참고하세요.

## 라이선스 방향

현재 package는 `private: true`인 비공개/닫힌 알파입니다. Direct runtime package의 선언 라이선스는 상용 비공개 제품과 양립 가능한 permissive 계열을 선택했지만, 이것만으로 공개·상용 배포 승인이 끝난 것은 아닙니다.

- VexFlow 5 — MIT
- React — MIT
- lucide-react — ISC
- fast-xml-parser 5 — MIT; 제한된 uncompressed score-partwise MusicXML import parser
- 생성된 소셜 프리뷰 — 프로젝트 자산

정확한 설치 버전, 근거와 미해결 사항은 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)에 기록합니다. 현재 production client bundle의 Academico Regular/Bold, Bravura, Gonville, Petaluma, Petaluma Script **6개 font payload**는 정확한 byte·provenance·license가 확인됐고 Leland는 포함되지 않습니다. Font 관련 남은 상용 gate는 Academico·Bravura·Petaluma 계열의 완전한 OFL text·copyright notice와 Gonville `LICENCE.txt`를 실제 배포물의 사용자가 접근 가능한 Licenses surface에서 제공하는 것입니다.

그 밖에도 npm artifact에 전체 license text가 없는 package의 canonical notice와 실제 production artifact의 transitive dependency·asset SBOM을 확인해야 합니다. 이 배포 gate가 닫히기 전에는 상용 배포 준비 완료로 표시하지 않습니다.

향후 self-hosted SMuFL/Bravura, 오케스트라 sample, MusicXML corpus, Verovio 같은 선택적 엔진을 도입할 때는 소프트웨어 라이선스와 font·콘텐츠·음원 라이선스를 각각 다시 검토합니다.
