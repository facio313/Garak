# Garak UI·UX 개선 연구 근거

- 요청일: 2026-10-13
- 목적: 악보 편집기의 시각적 복잡성, 조작 발견 가능성, 입력 상태 전달을 개선할 근거를 정리한다.
- 범위: 연구에서 확인한 사실, Garak에 적용하는 설계 판단, 아직 검증하지 않은 효과를 구분한다.
- 조사 도구: Search 스킬과 Exa 검색·원문 읽기 도구.
- 검색 관점: 시각적 복잡성과 미감, 사용자 제어 인터페이스, 모드 오류와 피드백, 단축키 학습의 네 가지.
- 검색량: 7회 검색의 `numResults` 합계 47건(`sources_reviewed: 47`). 이는 중복을 포함한 검색 결과 수이며 독립 논문 수가 아니다.
- 최종 근거: 중복 출판 페이지와 동일 연구 계열을 구분하여 독립 논문 4편을 선정하고 원저자 소속 기관 또는 학회 출처를 확인했다.

## 1. 시각적 복잡성과 익숙한 구조

**Tuch, Presslaber, Stöcklin, Opwis & Bargas-Avila (2012)**, *The role of visual complexity and prototypicality regarding first impression of websites: Working towards understanding aesthetic judgments*, International Journal of Human-Computer Studies, 70(11), 794–811.

- 출처: [Google Research 서지·초록](https://research.google/pubs/the-role-of-visual-complexity-and-prototypicality-regarding-first-impression-of-websites-working-towards-understanding-aesthetic-judgments/), [저자 원문](https://static.googleusercontent.com/media/research.google.com/en/us/pubs/archive/38315.pdf).
- 출처 품질: 공동저자 소속 연구기관이 제공하는 서지·초록과 논문 원문이다.
- 확인한 사실: 두 실험에서 시각적 복잡성과 전형성, 즉 해당 종류의 웹사이트다운 익숙한 구조가 짧은 노출 후 미감 평가에 영향을 주었다.
- 확인한 사실: 첫 실험은 실제 사이트 스크린샷 119개를 50/500/1000ms 동안 제시했고, 후속 실험은 17/33/50ms 노출을 사용했다.
- 확인한 사실: 낮은 복잡성과 높은 전형성의 조합이 높은 미감 평가를 받았다.
- 적용 판단: 악보를 중심으로 도구·설정·문서 정보를 구분하고, 과도한 구분선·중복 안내·여러 강조색이 서로 경쟁하지 않도록 정리한다.
- 적용 판단: 긴 가로 도구를 의미별 그룹으로 나누고 DOM 순서를 유지한 두 줄 배치로 구성하여 시각적 탐색과 키보드 탐색의 순서가 일치하도록 한다.
- 한계: 기업 웹사이트의 첫인상 평가이며 음악 편집기의 작업 속도, 오류율, 장기 만족도를 직접 측정한 연구가 아니다.
- 한계: 3열 구조 자체가 나쁘다거나 기능을 많이 숨길수록 좋다는 결론은 도출할 수 없다.

## 2. 사용자가 제어하는 정보량과 전체 기능 접근

**McGrenere, Baecker & Booth (2007)**, *A Field Evaluation of an Adaptable Two-Interface Design for Feature-Rich Software*.

- 출처: [UBC 저자 원문](https://www.cs.ubc.ca/~joanna/papers/ToCHI2007_McGrenere_notFinalFormatting.pdf), [관련 CHI 2002 선행 발표](https://dl.acm.org/doi/10.1145/503376.503406).
- 출처 품질: 연구자의 대학 사이트에 공개된 ACM 논문 원고와 학회 출판 기록이다. 2002·2007 발표를 독립된 두 근거로 세지 않았다.
- 확인한 사실: Word 2000의 자동 적응 메뉴와 사용자가 직접 기능을 선택하는 개인화 화면·전체 화면 전환 프로토타입을 20명 현장 실험에서 비교했다.
- 확인한 사실: 이해하기 쉬운 개인화 수단이 있을 때 다수가 실제로 화면을 개인화했고, 비교 대상보다 탐색·학습 경험이 좋았다.
- 확인한 사실: 개인화 화면에서도 기능 순서를 보존하고 전체 기능 화면에 빠르게 접근할 수 있게 설계했다.
- 적용 판단: Inspector에서 Event/Score/Part 범위를 사용자가 선택하게 하고 현재 범위를 분명히 표시한다.
- 적용 판단: 모바일에서는 설정을 세로 패널로 배치하고, 패널의 목적과 조작 방법을 설명하여 필요한 기능을 다시 찾을 수 있게 한다.
- 한계: 당시 Word의 특정 자동 메뉴와 비교한 결과이며 모든 자동 인터페이스보다 모든 수동 인터페이스가 낫다는 증거는 아니다.
- 한계: 정해진 탭이나 접기 UI 자체를 직접 검증하지 않았다. 사용자에게 필요한 기능이 숨겨져 접근 비용이 커지는지 별도로 확인해야 한다.

## 3. 입력 모드와 현재 상태의 지속적인 피드백

**Sellen, Kurtenbach & Buxton (1992)**, *The Prevention of Mode Errors Through Sensory Feedback*, Human–Computer Interaction, 7(2), 141–164.

- 출처: [Microsoft Research 서지·초록](https://www.microsoft.com/en-us/research/publication/the-prevention-of-mode-errors-through-sensory-feedback/), [논문 원문](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/08/sellen-kurtenbach-buxton-1992.pdf).
- 출처 품질: 저자 연구기관이 제공한 논문과 실험 요약이다.
- 확인한 사실: 텍스트 삽입 모드와 명령 모드를 혼동하는 오류를 두 실험으로 조사했다.
- 확인한 사실: 시각적 상태 피드백과 근감각 피드백 모두 모드 오류를 줄였고, 사용자가 누르고 있는 동안 모드를 유지하는 조건이 단순 전환보다 효과적이었다.
- 적용 판단: 선택·입력 상태와 현재 편집 범위는 해당 조작 근처에서 확인할 수 있도록 표시한다.
- 적용 판단: Score/Part 전환 및 확대·축소를 악보 캔버스 가까이 두어 조작과 그 결과를 함께 확인하도록 한다.
- 적용 판단: 선택·기본·강조·비활성 상태를 구별하는 역할 기반 색을 사용하고, 필요한 상태는 이름이나 형태로도 전달한다.
- 한계: 텍스트 편집·키보드·풋페달 조건의 실험이다. 특정 배지, 색상, 위치 변경의 효과를 직접 입증하지 않는다.
- 한계: 색상 외 정보를 병행하는 것은 접근성 설계 판단이며, 이 논문에서 검증한 독립 결과로 인용하지 않는다.

## 4. 작업 맥락에서 단축키를 발견하고 익히기

**Malacria, Bailly, Harrison, Cockburn & Gutwin (2013)**, *Promoting Hotkey Use through Rehearsal with ExposeHK*, CHI 2013, 573–582.

- 출처: [Canterbury 저자 원문](https://www.csse.canterbury.ac.nz/andrew.cockburn/papers/ehk.pdf), [ACM 원문](https://dl.acm.org/doi/pdf/10.1145/2470654.2470735).
- 출처 품질: 저자 대학에 공개된 학회 발표 원문과 ACM 출판본이다.
- 확인한 사실: 보조키를 누르면 기존 명령 위치에 단축키가 표시되고 바로 실행할 수 있는 ExposeHK를 툴바·메뉴·리본의 세 실험에서 평가했다.
- 확인한 사실: 비교 조건보다 더 많은 단축키를 더 자주 사용했으며 명령 선택이 빨라지고 선호도가 높았다.
- 적용 판단: 기존 단축키와 명령의 연결 및 위치를 안정적으로 유지하고 실제 기능 가까이에서 확인할 수 있도록 한다.
- 적용 판단: File처럼 아이콘만으로 뜻을 추측해야 했던 명령에 시각적 이름을 제공하는 것은 명령 발견을 돕기 위한 제품 설계 판단이다.
- 한계: 논문은 누르고 보는 오버레이와 즉시 실행을 평가했다. 이름·툴팁·키 표시만 추가해 동일한 학습 효과를 얻었다고 말할 수 없다.
- 한계: 실험 참가자는 사전 설명과 연습을 받았다. 실제 제품에서 사용자가 이 기능을 스스로 발견하는 문제는 저자도 후속 과제로 남겼다.

## 5. 디자인 참조와 적용 범위

아래 자료는 주작업에서 직접 확인한 디자인 참조다. 논문의 실험 결과와 구분하며, 외부 패키지·스킬을 설치하거나 자산을 복사하지 않고 기존 구현에 원칙을 적용한다.

- [UI UX Pro Max Skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill): 대비, 기능별 조작 대상, 화면 잘림 회피 등 점검 관점을 참고한다. 권고를 Garak의 효과 검증 결과로 취급하지 않는다.
- [Freesources](https://freesourc.es): 디자인 자료를 찾는 큐레이션 사이트로 활용한다. 자체 디자인 시스템이나 검증된 규격으로 표기하지 않는다.
- [SEED Action Button](https://seed-design.io/react/components/action-button): 주요·보조 액션의 위계와 조작 상태 표현을 참고한다.
- [SEED Segmented Control](https://seed-design.io/react/components/segmented-control): 상호 배타적인 범위 선택에서 현재 선택과 선택 가능한 항목을 분명히 보여주는 방식을 참고한다.
- [SEED Color](https://seed-design.io/docs/foundation/color): 표면·텍스트·경계·강조·상태 등 역할에 따라 색을 조직하는 원칙을 참고한다.

## 6. 이번 구현 방향과 검증 경계

- 긴 가로 도구: 의미별 두 줄 그룹, DOM 순서와 화면 순서의 일치, 좁은 화면에서 조작 대상 잘림 방지.
- 모바일 설정: 세로 패널과 목적 설명을 통해 사용 가능한 공간과 조작 순서를 분명히 전달.
- 악보 캔버스: Score/Part 및 확대·축소 조작을 결과가 나타나는 영역 가까이 배치.
- Inspector: Event/Score/Part 범위를 사용자 선택으로 전환하고 현재 범위를 표시.
- 시각 체계: File 이름을 드러내고 역할별 색, 글자 크기, 정보의 강조 수준을 정리.
- 위 항목은 연구에서 도출한 적용 판단이다. 최종 구현 상태와 실제 명령·테스트 결과는 [SESSION_HANDOFF.md](./SESSION_HANDOFF.md)에 기록한다.
- 사용자 실험을 수행했다고 확인하지 않았으므로 사용성·작업 속도·오류율 개선을 수치로 주장하지 않는다.
- 실제 단말의 VoiceOver 검증과 운영 배포는 수행 사실이 확인되지 않았으며 후속 또는 보류 항목이다.
- 후속 사용자 검증에서는 첫 음표 입력, 편집 범위 변경, 재생, 저장 등 실제 작업을 기준으로 발견 실패·오입력·소요 시간을 살펴볼 수 있다.
- 자동 테스트·화면 확인은 구현 회귀와 배치를 점검하는 근거이며, 사람의 사용성 평가를 대신하지 않는다.
