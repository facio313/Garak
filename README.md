# Garak Studio

Garak은 브라우저에서 솔로, 앙상블, 오케스트라 악보를 빠르게 작성하기 위한 웹 악보 편집기입니다. 현재 저장소는 단순 화면 시안이 아니라, 의미 기반 악보 모델과 실제 SVG 사보, 음표 입력, 재생, 저장, 내보내기를 한 흐름으로 연결한 알파 버전입니다.

## 지금 할 수 있는 일

- Solo, String quartet, Chamber orchestra, Symphony orchestra 템플릿으로 새 악보 만들기
- 48개 이상의 표준 관현악·건반·성악 악기 검색 및 파트 추가/삭제
- treble, alto, bass, percussion clef를 VexFlow 5 SVG로 사보
- 온음표, 2분음표, 4분음표, 8분음표, 16분음표와 한 점음표 입력
- 음표·쉼표·샵·플랫·내추럴 및 동일음 붙임줄 입력
- 악보 단위 4/4, 3/4, 6/8 박자 선택과 정확한 마디 용량 검증
- 마디 용량을 넘기지 않고 다음 마디로 자동 진행
- 키보드와 화면 툴바를 병행한 빠른 입력
- 최대 100단계 snapshot undo/redo
- 총보와 선택 파트 보기 전환
- 파트별 mute/solo와 written→sounding pitch를 반영한 Web Audio 재생
- versioned Garak JSON 자동 저장, 새로고침 복구, 파일 다운로드·업로드
- MusicXML 4.0, Standard MIDI File, 인쇄/PDF 내보내기
- 4마디 이후에도 여러 시스템으로 계속 이어지는 악보
- 데스크톱, 축소 화면, 인쇄 전용 레이아웃

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

`npm test`는 프로덕션 빌드를 새로 만들고 음악 코어 테스트와 실제 서버 렌더 테스트를 함께 실행합니다.

## 키보드 입력

악보를 클릭하거나 키보드 포커스를 둔 뒤 다음 단축키를 사용할 수 있습니다.

| 키 | 동작 |
|---|---|
| `A`–`G` | 현재 옥타브·임시표·음가로 음표 입력 |
| `R` | 현재 음가의 쉼표 입력 |
| `1`–`5` | 온음표 → 16분음표 선택 |
| `.` | 점음표 토글 |
| `T` | 마지막 두 동일음 붙임줄 토글 |
| `↑` / `↓` | 입력 옥타브 변경 |
| `Backspace` / `Delete` | 선택 파트의 마지막 이벤트 삭제 |
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

악보의 원본은 화면 좌표나 VexFlow 객체가 아닙니다. 기보음, 음가, 성부, 파트, 악기 조옮김을 보존하는 자체 `ScoreDocument`가 원본이며 화면·재생·내보내기는 모두 같은 모델을 읽습니다. 악기 파트에는 catalog ID뿐 아니라 생성 당시 transposition과 MIDI metadata snapshot을 저장해, 카탈로그 수정이 기존 악보의 소리를 바꾸지 않게 했습니다.

리듬은 quarter note당 960의 정수 tick으로 계산합니다. 현재 지원하는 음가와 한 점음표를 반올림 없이 표현하며, 향후에는 같은 공개 API 뒤에서 유리수 기반 tuplet 모델로 확장합니다.

## 저장소 구조

```text
app/                    앱 진입점, 전역 스타일, 메타데이터
components/             편집기 UI와 교체 가능한 VexFlow 렌더러
lib/music/              음악 모델, 악기 카탈로그, 명령, export, playback plan
tests/                  도메인 불변식과 실제 서버 렌더 검증
docs/ARCHITECTURE.md     상용화를 고려한 장기 기술 설계
docs/ROADMAP.md          Finale/Sibelius/MuseScore급 확장 로드맵
docs/SESSION_HANDOFF.md  다음 작업자가 즉시 이어갈 체크리스트
```

## 현재 알파의 명확한 경계

현재 UI는 Staff당 Voice 1개와 NoteEvent당 음 하나를 편집하며, 박자와 C major 조표는 악보 전체에 적용합니다. 피아노·하프의 grand staff, 화음, 다성부, 자동 빔, tuplet, grace note, articulation, dynamics, lyrics, percussion map editor, MusicXML import, 전문 페이지 나눔, 고품질 오케스트라 음원, 클라우드 협업은 아직 지원하지 않습니다. 구현되지 않은 기능을 작동하는 것처럼 표시하지 않습니다.

전체 제품 설계와 단계별 완료 기준은 [아키텍처](docs/ARCHITECTURE.md)와 [로드맵](docs/ROADMAP.md)을 참고하세요.

## 라이선스 방향

현재 핵심 런타임은 상용 비공개 제품과 양립 가능한 라이선스를 선택했습니다.

- VexFlow 5 — MIT
- React — MIT
- lucide-react — ISC
- 생성된 소셜 프리뷰 — 프로젝트 자산

향후 SMuFL/Bravura, 오케스트라 샘플, MusicXML corpus, Verovio 같은 선택적 엔진을 도입할 때는 소프트웨어 라이선스와 콘텐츠/음원 라이선스를 별도로 검토하고 `THIRD_PARTY_NOTICES`와 SBOM을 유지해야 합니다.
