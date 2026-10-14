# 다음 세션 이어하기

마지막 갱신: 2026-10-15 KST

## 2026-10-15 입력 메뉴 유지 및 운영 배포 (진행 중)

- 사용자 명시 승인: 브라우저 주석 반영 후 운영 배포까지 완료. 기존에 완료한 악보 편집/연습 개선과 함께 현재 codex 작업을 main에 반영. dev 및 cursor 변경 없음.
- 원형 음표 버튼의 +/− 배지와 불필요한 CSS 삭제. 입력 메뉴는 다른 음표, 인스펙터, Continue input, 파일/범위/도움말, Tap staff 등을 눌러도 유지. 버튼 재클릭·메뉴 닫기·Escape는 명시적으로 닫음. 최초 진입은 닫힘 유지. 바깥 클릭은 임시 도움말만 닫음.
- 로컬 typecheck, 변경 파일 eslint, rendered-html 9개 통과. 기존 '바깥 클릭/Tap staff 자동 닫기' 계약을 새 요구에 맞게 갱신. UI에서 다른 음표·파일 메뉴·Tap staff 후 aria-expanded=true, 버튼 재클릭 false 확인. 악보 데이터 편집 없음. Screenshot `/tmp/garak-palette-persistent.png`.
- 실제 운영 경로는 현재 repository `docs/DEPLOYMENT.md` 및 workflow 기준 `https://bonifacio.work/garak/`; skill inventory의 Sites 주소는 과거 정보. 마지막 성공 운영 SHA `c836a32ed9693aa1c638c83d2ea902c084a1e5f4`, deploy run 32714405266. main Validate 성공→ARM64 이미지 smoke→제한 SSH deploy→loopback readiness 순서. 실패 시 이전 healthy SHA 자동 복구 계약. 공유 인프라·데이터베이스 변경 없음.

## 2026-10-15 실제 여러 마디 작곡·범위 편집·내보내기 흐름 개선 (완료)

- `cks-release-audit`를 사용해 3/4, BPM 84 피아노 곡을 UI에서 10마디까지 작성. 원래 dirty 작업 보존, 커밋/푸시/배포 없음. 원본은 작업 전 `Downloads/Drag-note-QA.garak (43).json`으로 백업.
- 일반/오선 클릭 입력이 남은 박부터 시작하고 마디를 넘으면 기존 reflow 경로로 분할·붙임줄 생성. 뒤쪽 음·화음·붙임줄 이동은 한 Undo 단위, 표현 불가 길이/안전 한도는 원본 유지. 꽉 찬 클릭 대상은 다른 마디에 조용히 입력하지 않고 거절. Tab으로 정한 마디를 채우면 그 뒤로 순차 입력; 이전 빈 마디로 돌아가지 않음.
- 자동 분할 음에 화음 추가 시 모든 온전한 rhythmGroup 조각에 새 음과 붙임줄을 생성. 머리/꼬리 선택과 latest-entry 공통 경로. 이후 점 순환이 원래 전체 길이를 유지. 수동으로 따로 작성한 붙임줄은 선택 이벤트에만 화음 추가하는 기존 동작 유지.
- Undo/Redo가 범위와 열린 도구·접힘 상태를 함께 복원. 파일 메뉴에 취소/재실행 대상 동작 표시. 빈 마디 추가 시 현재 범위·복사/이동 목적지 대기 상태 유지.
- 320px에서 범위 선택 전에 400px 가까운 도구가 악보를 가리고 6개 동작 글자가 겹친 문제 발견. 범위 모드는 접힌 도구로 시작, 좁은 화면 동작 3열, 펼친 내용 높이 40dvh 안에서 내부 스크롤. 44px 조작 크기 유지.
- 내보내기: MusicXML `<rights>`로 기존 copyright 보존, MIDI 모든 트랙 EOT를 전체 마디 길이에 맞춰 마지막 쉼표/빈 마디 보존. 파일 메뉴에 모든 파트 내보내기 범위와 MIDI의 지속음 볼륨 변화 한계 명시. 별도 export_journey 작업이 exporters/test를 수정했고 주 작업에서 통합·검증함.
- UI 검증: 긴 C4 온음표→Shift E/G 화음→점온음표, 연결 음높이 수정/Undo, 7마디 연속 입력 및 마지막 Tab 자동 추가. m1–2 화음 범위를 m8–9로 복사하고 p/tenuto/crescendo 적용, 삭제/Undo 파일 전체 일치. m10–11 이동/Undo와 m10 오선 클릭 온음표 분할/Undo 확인. 320×568·390×844에서 범위 선택/조옮김/Undo/파일 메뉴 조작, 1280 화면에서 파일 열기 확인.
- 실제 파일 검증: `Evening-phrase-QA.garak (2).json`→열기→브라우저 저장→새로고침→(4).json 전체 일치. UI에서 MusicXML을 다시 연 (3).json은 10마디/BPM84/6ties/1hairpin/19attacks 및 모든 playback 속성(시간·음량 envelope 포함) 동일. 실제 MIDI 2개 트랙 모두 14,400 ticks=30 quarter beats로 끝나 마지막 빈 10마디 보존. 저작권 문자열 escaping/왕복은 전용 회귀로 검증.
- 최종 검증: typecheck/lint/build, unit 234개, rendered-html 9개, license-artifacts 8개, diff-check 통과. 로그 `/tmp/garak-phrase-{tests,build,rendered}.log`. 기존 source-contract 검사 1개를 range metadata가 추가된 history 형태에 맞게 수정 후 통과. 소스와 실행 QA 사본의 9개 구현/테스트 파일 해시 일치.
- 원본 (43).json을 다시 열고 저장/새로고침/다운로드한 (44).json과 전체 일치 확인. 양쪽 패널 360px 펼침, 입력 메뉴 닫힘, viewport 원복. 연습 설정은 변경하지 않음. Screenshot `/tmp/garak-phrase-undo-320.png`. 실물 iPad/Pencil 및 실제 출력음 청취 검증은 하지 않음. 이번 범위에 추가 승인 필요 사항 없음.

## 2026-10-15 악보 생성·입력·수정·저장 전체 흐름 개선 (완료)

- `cks-release-audit`로 실제 생성→키보드/터치 입력→화음/붙임줄 수정→삭제/Undo→다운로드→열기→자동 복원 흐름을 점검하고 발견한 문제를 묶어 수정. 기존 dirty 작업 보존, 커밋/푸시/배포 없음.
- 새 악보: Solo 악기 선택(카탈로그의 실제 오선·이조 정보 사용), 초기 박자/템포 추가. Solo 카드에 악기 이름 표시. 제목 누락과 BPM 30–300 검증 유지. 320px에서도 2열 템플릿과 박자/템포, 고정 제목·동작 버튼으로 조작 가능. 큰 화면에서는 불필요한 세로 스크롤을 줄임.
- 생성/파일 열기 완료 후 악보로 포커스 이동하여 바로 QWERTYU 입력 가능. 빈 오선에 키보드/터치 시작 안내 추가. 기본 플로팅은 닫힘 유지, Touch input을 눌렀을 때만 버튼 입력으로 열림.
- 선택 요약 및 인스펙터에 Continue input 추가. 수정 선택·화음/범위 모드 해제, 모바일 패널 닫기, 실제 NEXT 입력 위치로 복귀. Escape도 같은 경로. 처음 구현의 선택 마디 고정은 꽉 찬 마디에 새 음을 못 넣는 문제가 있어 제거하고 기존 자동 다음 위치 사용.
- 파일 메뉴에 액션 메시지와 독립된 저장 중/완료/실패/일시중지 표시. 저장 함수의 실제 결과로만 완료 표시. 생성/가져오기/Undo/자동 저장/직접 저장/페이지 종료 시 저장 결과와 연결. 브라우저 내부 저장과 기기간 파일 복사를 구분하는 안내.
- 실제 재생에서 무음 메트로놈 클릭까지 음표 수에 포함되는 오류 발견. 재생 구간의 musicNotes만 세도록 수정(테스트 곡 27→3). 오디오 처리와 재생 시계는 변경 없음.
- UI 검증: 320×568에서 6/8·72 BPM 피아노 생성 직후 메뉴 닫힌 상태로 2→Q 입력. Shift+E로 화음, 터치로 whole+1dot/G4 수정해 m1–2 C4+G4 붙임줄 2개 생성. Continue input 후 m3 D4 입력 성공. 삭제→쉼표→파일 메뉴 Undo 복원 확인. Flute·3/4·112 BPM 생성 및 Touch input→C4 입력 확인. 빈 제목은 생성 차단/제목 포커스. 1280×900 레이아웃, 6/8 재생/일시정지/재개/정지 확인. 실제 iPad·오디오 청취 검증은 하지 않음.
- 저장 검증: Downloads/Journey-6-8-QA.garak (1).json → UI 열기 → (2).json 전체 JSON 정확히 일치(음표/화음/붙임줄/박자/템포 포함). 새로고침 복원도 확인. Flute-first-notes-QA.garak.json 악기/1오선/모든 마디3/4/tempo112 확인.
- 테스트: unit225 통과(새 2개: Solo 악기별 오선/이조·설정 저장 왕복, ensemble 유지/잘못된 악기 거부). 최종 typecheck/lint/build/rendered-html9/diffcheck 통과. 기존 rendered-html의 queue.noteCount 기대값이 새 음악 음표 수 표시와 충돌해 실패했고, 변경된 요구대로 클릭을 제외한 musicNoteCount/구간 조건을 검증하도록 수정 후 재실행 통과. 로그 /tmp/garak-journey-{tests,build,rendered}.log.
- 원본 Downloads/Drag-note-QA.garak (41).json 복원·브라우저 저장 완료. 새로고침 후 복원 유지, viewport 원복, (42).json 다운로드와 (41).json 전체 동일 확인. 브라우저 console error 없음. 스크린샷 /tmp/garak-journey-new-desktop.png, /tmp/garak-journey-new-320.png, /tmp/garak-journey-start-320.png.

## 2026-10-15 초기화 취소·연습 메뉴 사용성 묶음 개선 (완료)

- reset 직전 PracticeSettings(rate/metro/volume/count/repeat/bars/guide) 보관 및 초기화 취소 추가. 공통applyPracticeSettings로 reset/undo 모두live rate/repeat/gain만수정, score/tempo/follow 불변. reset-undo snapshot은별도storagekey로reload후에도복원. defaults인경우resetdisabled로snapshot보호. 수동practice변경시record만료(follow는독립유지), undo후소비. 저장실패·오염된기록·변경된설정에는오래된undo미노출. lib/practice-settings.ts로범위와검증을명시.
- 함께개선: 메뉴상단sticky닫기, 클릭음량숫자%/0%무음표시, reset/undo결과메뉴내status유지, reset후undo로/undo후reset으로키보드focus이동. 사용자요청대로작업마다새프롬프트를요구하지않고발견한관련사용성문제묶음처리.
- React compiler lint가기존callback의stable setter의존성을요구하여해당deps에setEventEditError/setMetadataDraft/setTitleError명시(기능불변). 최종typecheck/lint/build/unit223/rendered-html9/diffcheck통과. /tmp/garak-reset-undo-{tests,build,rendered}.log. 새3회귀:정확한reset/undo저장+score/follow보호,오염/수동변경snapshot거부,부분저장실패시obsoleteundo방지.
- 브라우저:6/8 chord/tie m1–2loop .75×35%count/repeaton2bars guideoff followoff. countpause1/2bar1/6beat에서reset→undo위치불변·모든설정정확복원. 음악재생중reset→undo후Pause가능/위치진행유지. resetreload후undo기록존재,320×568에서취소클릭·닫기top79고정. undo후save/reload .75/35/2bars/repeaton/followoff유지,record소비확인. reset뒤volume0수동변경시record없음/0%무음표시확인. 다운로드6-8-Metronome-QA.garak (6).json updatedAt외원본동일(tempo60),consoleerror없음.
- 원본 Downloads/Drag-note-QA.garak (40).json 복원/저장,모든원래practice defaults/followon/viewport원복. screenshot garak-reset-undo-short.png. 실제음청취/iPad검증없음. 커밋/푸시/배포없음.

## 2026-10-15 연습 설정 기본값 복원 (완료)

- 메뉴하단 기본값으로 되돌리기 버튼 추가. rate1/metronomeoff/volume60/countoff/repeatoff/bars1/guideon으로 state와 해당storagekey만 갱신. score/tempo/follow/패널 등 유지. live rate setter/repeat setter/click gain만 적용해 현재voice/clock/loop/pause유지. 진행중count는기존길이완료. 실패시 재생오류는중지, 저장오류는session-only경고표시. 버튼하단정확한범위설명.
- 검증: typecheck/lint/build/rendered-html9/diffcheck통과. /tmp/garak-practice-reset-{build,rendered}.log. 브라우저6/8 chord/tie range에서모든설정비기본값+followoff→2마디countpause중reset: 현재1/2마디1/6박유지, 기본값복원/followoff보존. resume후음악반복중rate.5/metroon→reset: Pause가능/위치계속진행확인. save/reload모든기본값/followoff보존. 다운로드6-8-Metronome-QA.garak (5).json 원본과updatedAt외모든값동일(tempo60).320×700 내부scroll로reset누름확인, consoleerror없음.
- 원본 Downloads/Drag-note-QA.garak (39).json 복원/저장, followon/viewport원복. screenshot garak-practice-reset-320.png. 오디오엔진변경없어unit재실행안함. 실제출력음청취/iPad검증없음.커밋/푸시/배포없음.

## 2026-10-15 연습 설정 메뉴 및 좁은 헤더 (완료)

- 메트로놈/클릭음량/카운트인 토글·길이·반복/박자표시/배속/자동따라가기를 native auto popover인 연습 설정으로 이동. 기존state/저장key/handler 유지. 이름 있는44px행, 닫기버튼/Escape/바깥클릭 native동작, viewport높이내부scroll. 재생·일시정지·Stop·현재박은 헤더에 유지. practice-settings CSS top-layer로 headerwidth영향없음.
- 620px이하 제목·돌아가기 숨기고 transport+headeractions2열, focus버튼은파일메뉴로이동하여접근유지.320px play44/stop32/settings32/guide108 및panel/file32로맞춤.768/1024헤더도폭내배치. 전체header62px유지.
- 검증: 최종 typecheck/lint/build/rendered-html9/diffcheck 통과. /tmp/garak-practice-menu-{build,rendered}.log. 오디오/저장로직변경없어unit220재실행안함. 실제320/390/768/1024브라우저확인:menu선택 counton2bars/rate.5/volume0→countpause→메뉴rate2→resume→음악박표시→reload후2bars/counton/rate2/volume0/guideon유지. Escape닫기확인. 첫320검사에서textclip발견후폭·글꼴수정해해결. consoleerror없음.
- 원래악보편집없음. countoff/bars1/rate1/volume60/viewport복원. screenshot garak-practice-header-320.png 및 garak-practice-menu-320.png. iPad실물검증없음. 커밋/푸시/배포없음.

## 2026-10-15 시각 박자 표시 독립 토글 (완료)

- 상단 Eye 아이콘 Show beat guide(40×40) 추가, 기본on. garak.practice.beat-guide=on/off로 독립 저장/복원. countInProgress || beatGuideEnabled 조건으로 일반표시만 숨기고 최초/반복 카운트는 항상 표시. 토글은 UI state만 갱신해 재생시계/음량/position을 건드리지 않음. 작은 화면에서도 버튼유지, header62px. 도움말 및 silent상태 문구 수정.
- 검증: QA typecheck/lint/build/rendered-html9 및 git diff --check 통과(/tmp/garak-guide-toggle-{build,rendered}.log). 소리와별도 저장/defaulton/count우선 표시 source 계약 추가. 오디오/박자계산 변경없어 기존unit220은 이번 턴 재실행안함.
- 브라우저6/8: guideoff 초기count 표시→2배속count끝 일반표시0 확인. pause상태guide on/off 및.5배속변경전후 m1beat1 동일, metronomeoff유지. save/reload guideoff+metronomeon 독립복원. m1–2 loop2× 일반표시숨김/다음count1/1beat1 표시확인. consoleerror없음. 1280에서button40px/header62px. screenshot garak-beat-guide-toggle.png.
- 원본 Downloads/Drag-note-QA.garak (38).json 복원/저장, guideon/metronomeoff/countoff/repeatoff/rate1/viewport복원. 실제음청취/iPad검증없음. 커밋/푸시/배포없음.

## 2026-10-15 상시 시각 메트로놈 (완료)

- 재생 중 count-in 이후에도 같은38px 상단영역에 Playing/Paused · m.N 및 현재박/분자 beat 표시. count와 음악 모두 beat-guide 스타일 공유, 첫박◆/진한배경, 나머지·/연한배경. 음악은 기존 locatePlaybackPosition(live.position)에서 beat/measure를 취하고 현재마디의 분자 사용. 메트로놈토글/클릭음량과 독립, 작은화면에서도 표시.
- 완전무음 및 쉼표구간 연습 지원: 음표가 없거나모두mute인 경우 재생차단 제거, to<=from만 차단. 음악·클릭 둘다무음이면 Silent beat guide 상태표시. 도움말 설명 추가. 렌더 source contract는 새 동작에 맞춤.
- 검증: typecheck/lint/build, unit220/rendered-html9/diffcheck 통과. 로그 /tmp/garak-beat-guide-{tests,build,rendered}.log. 신규 무음 transport/semantic mapping 통합회귀:6/8 .75초beat2→pausedrate2유지→m2beat1→beat4→loopm1beat1. 기존 박자표변경 및 count/rate회귀 유지.
- 실제브라우저:6/8 fixture 카운트종료후 beatguide, pause중2→.5배속에서동일beat유지; m1–2 loop2×에서m2첫박및loop복귀확인. Metronome off, Click volume Home키로0확정, Piano Mute on에서m2첫박강조 및resume후beat2 확인. range.fill(0)는 React설정반영안되어Home키로대체. 1280×700에서header62px/guide38px, consolewarn/error없음. 직접소리청취/iPad하드웨어검증없음.
- 원본 Downloads/Drag-note-QA.garak (37).json 복원/저장. clickvolume60/rate1/countoff/repeatoff/viewport원복. screenshot garak-visual-metronome.png(상단과악보영역). 커밋/푸시/배포없음.

## 2026-10-14 카운트인 마디·박 표시 (완료)

- countInForPosition에 beatsPerBar를 포함하고 live.countInProgress가 실제 활성 카운트의 bar/bars/beat/beats를 반환. 최초/반복 모두 마디별 beat 리셋, 진행 중 길이 변경에도 활성 카운트 기준 유지. 테스트용 기존 Count는 beatsPerBar 생략 시 한 마디로 취급.
- 상단 카운트 표시는 38px 높이 두 줄(Count-in 또는 Paused · 2/2 bar / ◆ 1/6 beat). 각 첫 박에 진한 녹색 바탕·흰 글자·마름모 강조, 나머지 박 연한 배경. aria-label에 카운트인/마디/박/첫박 제공. 작은 화면에서도 카운트 표시 유지, 헤더62px 유지. 도움말 갱신.
- 검증: typecheck/lint/build/unit219/rendered-html9/diff-check 통과. /tmp/garak-count-display-{tests,build,rendered}.log. 회귀에서6/8 1마디6박→2마디1박→연주→반복1마디1박→2마디1박, 2배속변경 후2박 확인. 기존 pause/rate/길이전환 회귀도 새 progress 계약으로 검증.
- 실제 브라우저6/8 테스트: 최초1/2마디1박 pause→2배속→resume→2/2마디1박 강조 및 pause 확인. m1–2 구간반복 연주후2/2마디1박 pause→.75배속·길이1 변경에도2/2 유지→resume 다음count1/1마디2박 확인. 1280×700에서 헤더62px/counter38px, 콘솔오류없음. 스크린샷 garak-count-bar-beat.png. 실제 오디오 청취·iPad하드웨어 검증 없음.
- 원본 Downloads/Drag-note-QA.garak (36).json 복원/저장, count/repeat off·bars1·speed1 및viewport원복. 커밋/푸시/배포 없음.

## 2026-10-14 한·두 마디 카운트인 및 플로팅 배치 수정 (완료)

- 상단 Count-in length(1 bar/2 bars) 추가, garak.practice.count-in-bars 저장/복원. 최초/매 반복 카운트에 공통 적용. countInForPosition은 bars 인자로 전체 길이·클릭 수를 늘리고 각 마디 첫 박에 강세. 화면 카운터는 전체 박 수(6/8 두 마디=12박). 기존 live.setRepeatCountIn으로 음악/시계 유지, 이미 시작한 카운트는 원래 길이 완료 후 다음부터 새 길이 적용. 반복 토글은 최신 bars를 함께 전달해 오래된 closure 방지. 도움말/명칭 수정.
- 플로팅 메뉴 넓은 화면 grid에서 상태 문구가 한 칸을 차지해 도구 배치를 밀어내던 원인 수정: field-help가 전체 열을 차지. Length/Note 왼쪽, 나머지 오른쪽에 같은 높이로 배치. 좁은 화면 기존 3줄 유지.
- 검증: QA typecheck/lint/build, unit218개, rendered-html9개, git diff --check 통과. /tmp/garak-two-bars-{tests,build,rendered}.log. 신규 회귀: 4/4·6/8·2/2 두 마디 강세/길이/배속; 시작·반복 중 길이 여러 번 변경, frozen clock 배속 변경, 현재 12박 유지 후 다음 6박 적용.
- 브라우저: 6/8 화음/tie/crescendo m1–3 반복. 최초12박 pause→길이1/배속2 변경해도12박 유지. 반복Count-in3/12 pause→길이1/배속1→resume, 다음Count-in3/6 확인. 저장/reload 2bars 및 count/repeat on 복원. 다운로드 6-8-Metronome-QA.garak (4).json tempo/parts/ties/hairpins/measures/order 원본 동일. 2267px 메뉴 두 그룹 y1836 정렬, 1280×700 헤더62px/문서 가로넘침없음. console warn/error없음. 출력음 직접 청취·실물 iPad 검증은 안 함.
- 원본 Downloads/Drag-note-QA.garak (35).json 다시 열기/저장, count/repeat off·bars1·speed1 복원, viewport 원복. 스크린샷 garak-two-bar-wide.png. 수정 NotationStudio.tsx, metronome.ts, globals.css, music-core.test.ts, 이 문서. 커밋/푸시/배포 없음.

## 2026-10-14 재생 중 반복 카운트인 전환 (완료)

- Count-in every loop 토글을 live.setRepeatCountIn에 연결. 저장은 기존 key 유지. 음악 중 토글은 현재 pass를 보존하고 다음 pass 앞 gap부터 반영. 이미 count 구간에 진입한 경우 해당 한 마디를 끝내고 이후 반복에 설정 적용. 최초 카운트도 중간 제거하지 않음. 헤더 title/help/status 갱신.
- live engine은 current/future epoch(최대2개)로 각 구간의 반복 길이/queue를 관리. 현재 음악 중 toggle은 cycleStart epoch를 새 gap 설정으로 교체; count 중 toggle은 현재 epoch 끝에 새 epoch 예약. 아직 시작 전 voice만 취소, active voice 유지. transportId는 절대 cycleStart+event index로 안정화해 queue 재구성/배속 변경 시 current voice 중복 발음 방지. 두 epoch 경계의 미래 note는 한 경로에서만 예약.
- 검증: QA typecheck/lint/build, unit 216개, rendered-html9개, git diff --check 통과. /tmp/garak-live-repeat-{build,tests,rendered}.log. 신규 회귀는 lookahead로 이미 예약된 다음pass 취소→count 삽입, current oscillator start/stop 불변, count 중 off 뒤 full count 유지, frozen clock rate2× 변경 후 music onset2.73/3.73초(이후 gap없음) 검사. 기존 연속 speed/다양한 meter/count/loop 회귀 모두 통과.
- 브라우저 6/8 화음/tie/crescendo m1–2 loop: 재생 중 on→현재 m1 유지, 여러 배속(.25/.5/1.25/1.5/.75) 및 pause와 조합. Count-in1/6 pause→off→.75×에서 현재count 유지, resume→음악 m1beat5 확인. reload 후 off 유지. 저장 6-8-Metronome-QA.garak (3).json tempo/parts/ties/hairpins/measures/order 원본 동일. 실제 출력음 청취/녹음 또는 iPad하드웨어 검증 안 함.
- 원본 Downloads/Drag-note-QA.garak (34).json 열기/저장/reload 복원, rate1/repeat off/viewport 원복. 스크린샷 garak-live-loop-count.png. 수정: live-playback.ts, NotationStudio.tsx, music-core.test.ts, 이 문서. 커밋/푸시/배포 없음.

## 2026-10-14 반복마다 한 마디 카운트인 선택 (완료)

- 상단 Count-in every loop(Repeat2 아이콘) 토글 추가, garak.practice.repeat-count-in 저장/복원. 기본 off=연속 반복. on=첫 회차 전과 매 회차 사이 시작 마디 박자표로 한 마디 카운트. 활성 재생 중 바꾼 옵션은 다음 재생 시작부터 적용한다고 title/help 명시. 기존 최초 count-in 옵션은 독립 유지.
- live-playback: 반복용 queue는 원래 구간 musicDuration + count duration으로 구성, 음악/메트로놈은 구간 끝에서 잘라 count 중 겹치지 않음. COUNT_IN_PART 별도 cue는 count 출력 gain으로 전달(메트로놈 off와 독립, 클릭 음량 공유). score position은 count 중 구간 시작에 고정, countInProgress로 첫/반복 카운트 모두 표시. pause/rate 변경은 같은 clock/voice retiming 유지, seek는 곡 구간 offset으로 즉시 시작하고 이후 반복 count 유지.
- 검증: QA typecheck/lint/build, unit 215개, rendered-html 9개, git diff --check 통과. /tmp/garak-repeat-count-{build,tests,rendered}.log. 신규 회귀는 원본 절대 위치10초 구간의 3박 count/회차 간격/score position mapping/반복 count 도중 2× 변경 후 다음 music onset4.58초 검사. 기존 다양한 박자표/연속 반복/음악 voice 보존 회귀 유지.
- 브라우저: 6/8 m1–2 loop 1.5× first Count-in1/6, .25× 회차 끝 Count-in6/6→pause→.75× 동일 카운트 유지. reload 후 repeat-count on/.75× 복원. off→2× Loop 즉시 m1beat1→여러 회차 음악 진행, count 없음 확인. 1280×700 헤더62px 유지. 저장 6-8-Metronome-QA.garak (2).json tempo/parts/ties/hairpins/measures/order 원본 동일. 출력음 직접 청취/실물 iPad 검증 안 함.
- 사용자 원본 Downloads/Drag-note-QA.garak (33).json 열기/저장/reload 복원, repeat-count off/rate1/viewport 원복. 스크린샷 garak-loop-count-in.png. 수정: metronome.ts, live-playback.ts, NotationStudio.tsx, music-core.test.ts, 이 문서. 커밋/푸시/배포 없음.

## 2026-10-14 실시간 메트로놈·클릭 음량·설정 저장 (완료)

- 모든 beat를 같은 score-time queue로 예약하되 음악/메트로놈/카운트인 출력 gain을 분리. METRONOME_PART + count transportId로 라우팅. 재생 중 메트로놈 toggle은 click gain만 5ms time constant로 변경, 음악 voice/context/clock 유지. 꺼진 동안에도 미래 beat 스케줄을 유지해 다시 켜면 현재 박자에 합류. 악기 수에 따른 음악 master 보정은 클릭에 영향 없음.
- 상단 기존 줄에 64×40px 클릭 volume slider(0–100%, 5% step) 추가. 메트로놈/카운트인 공통 클릭 크기, 음악 음량 불변. 메트로놈 off도 count-in 출력 독립. Count-in 토글은 재생 중에도 변경 가능하되 다음 새 재생부터 적용한다고 title/help 명시.
- garak.practice.metronome/count-in/click-volume 저장/복원, 음량 유한값 검사와 0–100 제한, hydration 전 disabled, 저장 실패 상태 안내. 이 환경설정 prefix만 direct localStorage 계약 예외 허용. 메트로놈 off + 실제 음악 없음의 기존 무음 안내 유지.
- 검증: 최종 typecheck/lint/build, unit 214개, rendered-html 9개, git diff --check 통과. /tmp/garak-click-controls-{build,tests,rendered}.log. 신규 회귀는 count/music/metronome gain 라우팅 분리와 배속 변경 시 음악 voice 보존. 최종 UI 무음 guard 변경 후 type/lint/build/rendered 재검증.
- 실사용: 6/8 화음/tie/crescendo 악보 카운트 중 metro 켜기, 반복 1.5×에서 끄기/volume100, .75×에서 켜기/volume35; 음악 재생 상태/구간 유지. reload 후 metro on/count on/volume35/.75× 확인. 저장 Downloads/6-8-Metronome-QA.garak (1).json tempo/parts/ties/hairpins/measures/order 원본과 동일. 1280×700 헤더62px, slider64×40 확인. 실제 오디오 출력 청취/실물 iPad 검증 없음; UI WebAudio 실행과 경로 단위검증 수행.
- 원본 Downloads/Drag-note-QA.garak (32).json 열기/저장/reload 복원, 원래 metro off/count off/volume60/rate1로 저장 복귀, viewport reset. 콘솔 오류 없음. 스크린샷 garak-live-metronome.png. 수정: live-playback.ts, NotationStudio.tsx, globals.css, music-core.test.ts, rendered-html.test.mjs, 이 문서. 커밋/푸시/배포 없음.

## 2026-10-14 메트로놈·한 마디 카운트인 (완료)

- 상단 기존 transport에 Metronome(Drum)/One-measure count-in(Timer) 아이콘 토글 추가, 재생 전에 설정(활성 세션 중 disabled). 별도 줄 없음. 기본 off, 세션 설정. 도움말에 동작 명시.
- metronome.ts는 박자표 분모 기준 박마다 클릭(6/8은 8분음표 6번), 마디 첫 박은 높은 음/강한 velocity. 악보 박자표 변경을 따라감. 가상 playback note만 생성하며 저장 악보/내보내기에 추가하지 않음. 기존 오디오 clock/배속/일시정지/loop queue 공유.
- 시작 마디 박자표 한 마디 count-in, 최초 시작/새 Play에 한 번(반복 회차 사이 삽입 없음). 위치 이동은 즉시 재생, pause/resume는 현재 카운트 유지. live-playback negative elapsed 구간과 별도 once count queue로 곡 시작 이전 클릭만 예약. 배속 변경 시 남은 count와 음악 예약 모두 연속 clock으로 재조정. 헤더 Count-in n/N 표시.
- 검증: QA typecheck/lint/build, unit 213개, rendered-html 9개, git diff --check 통과. /tmp/garak-metronome-{build,tests,rendered}.log. 새 회귀 3/4→6/8→2/2 클릭 시각/강박, 시작 박자표 count-in, count 중 rate 변경/음악 지연 시작/반복 시 count 재삽입 없음.
- 실사용: 4/4 60bpm .5× 카운트 중 pause→1× 변경/동일 Count-in1/4→resume/음악 시작. 6/8 화음/tie/crescendo fixture m1–2 loop Count-in2/6 확인, 이후 여러 회차 m1 beat5에서 여전히 재생, 1.5× 변경에도 반복 유지. 1280×700 헤더 확인. 저장 Downloads/6-8-Metronome-QA.garak.json은 tempo/parts/ties/hairpins/measures/order 원본 동일. 출력음 직접 청취/실제 iPad 검증은 안 함.
- 사용자 원본 Downloads/Drag-note-QA.garak (31).json 열기/저장/reload 복원, 배속1×/viewport 원복. 스크린샷 garak-metronome-countin.png. 수정: metronome.ts(신규), live-playback.ts, NotationStudio.tsx, music-core.test.ts, rendered-html.test.mjs, 이 문서. 커밋/푸시/배포 없음.

## 2026-10-14 연속 배속 변경·배속 영구 저장 (완료)

- live-playback.ts: AudioContext를 유지하는 악보 시간 clock/voice registry 추가. 배속 변경 때 현재 score-time anchor를 유지하고 이미 울리는 oscillator는 재생성/start하지 않음. gain.cancelAndHoldAtTime으로 현재 진폭 고정 후 남은 envelope만 다시 예약하고 oscillator.stop 시각 교체. 아직 시작 전인 voice만 취소/새 배율로 예약. queue transportId=cycle:index로 재생 중 화음 중복 발음 방지(동일 pitch 중복도 index로 구별). 일반 pause/resume는 context suspend/resume 그대로.
- UI 배속 변경은 live.setRate 호출. garak.playback-speed에 배율 저장, hydration 때 whitelist 값만 복원, 저장 불가 상태 알림. score.tempo/저장 악보 데이터와 독립. 이전 문서의 배속 변경 재발음 가능 제한과 새로고침 1× 동작은 이번 변경으로 대체.
- 검증: QA typecheck/lint/build, unit 211개, rendered-html 9개 통과. /tmp/garak-continuous-{build,tests,rendered}.log. 새로운 live engine mock 검증은 지속 3음 chord의 oscillator/start/attack 개수 불변, hold automation, 종료시각 연장/단축, frozen clock 배율 변경, loop 다음회차 발음, 아직 시작 전 회차 취소를 검사. 기존 source contracts는 추출된 live engine clock/gain 경로를 검사하도록 갱신.
- 브라우저: 60bpm 화음/tie/crescendo fixture에서 .25→.75 재생 중 변경, m1–2 loop .5→1.25, pause .75 변경 동일위치, resume/다음회차/seek m2/.5 변경, 저장/reload 후 .5× 표시 확인. Native 다운로드 Playback-QA.garak (2).json은 tempo/parts/ties/hairpins/measureOrder 원본과 동일. 오디오 출력 직접 청취/녹음은 하지 않음; 실제 UI 재생과 AudioNode 생명주기 자동 검증 수행.
- 사용자 원본 Downloads/Drag-note-QA.garak (30).json 보관 후 열기/저장/reload 복원. viewport reset. 스크린샷 garak-continuous-speed.png. 테스트 배율은 원래 1×로 복귀. 수정: live-playback.ts(신규), playback-transport.ts, playback-gain.ts, NotationStudio.tsx, music-core.test.ts, rendered-html.test.mjs, 이 문서. 커밋/푸시/배포 없음.

## 2026-10-14 악보 템포와 독립적인 연습 배속 (완료)

- 헤더 Playback speed select(66×40px, .25/.5/.75/1/1.25/1.5/2×) 추가. score.tempo 변경/저장하지 않는 세션 설정. pause/resume/seek/loop에서 유지. 브라우저 재개시 1× 기본값; 배속 영구 저장은 요청 범위 아님.
- 큐/커서/반복 경계는 악보 시간 기준을 유지. AudioContext 경과 시간×rate로 악보 시간을 계산하고 playbackNoteAtRate로 onset/duration/notatedDuration/envelope offset만 rate로 나눔. 주파수와 velocity 불변. lookahead도 .35×rate로 변환해 실제 시간 기준 350ms 유지.
- 활성 세션 배율 변경은 playbackClockRef의 정확한 현재 위치와 기존 interval/loop로 오디오 예약 재시작. pause 중 변경은 새 context suspend로 일시정지 유지. 기존 큐 clipping으로 붙임줄 남은 길이/현재 셈여림 보존. 배율 변경 시 지속음 오디오 노드는 재생성되므로 미세한 재발음 가능; 일반 pause/resume는 기존 suspend/resume 유지.
- 검증: typecheck/lint/build, unit 210개, rendered-html 9개, git diff --check 통과. /tmp/garak-speed-{build,tests,rendered}.log. 추가 회귀는 모든 배속의 onset/duration/envelope 변환, pitch/velocity/source 불변 및 잘못된 rate 거부.
- 브라우저 실제 실행: 60bpm 화음/tie/crescendo 악보 .5× 시작, m3 beat2 pause→1.5× 변경 후 동일 위치/paused, resume/seek m2 후 1.5× 유지, m1–2 loop 2×→.75× 재생 중 변경/여러 회차 유지. 1280×700 header62px로 별도 줄 없음. 저장한 Downloads/Playback-QA.garak (1).json의 tempo60/parts/ties/hairpins/measureOrder fixture와 동일. 오디오 직접 청취/실물 iPad 검증은 안 함.
- 원본 Downloads/Drag-note-QA.garak (29).json 보관 후 열기/저장/reload 복원. viewport reset. 스크린샷 garak-practice-speed.png. 수정: NotationStudio.tsx, playback-transport.ts, globals.css, music-core.test.ts, 이 문서. 커밋/푸시/배포 없음.

## 2026-10-14 자동 추적 토글·수동 복귀 (완료)

- 상단 기존 재생 줄에 Scan 아이콘 Auto-follow playback 토글(aria-pressed, 40px target) 추가. garak.playback-follow=on/off를 별도 UI 환경설정으로 저장/복원. 기본 on, hydration 전 disabled, 저장 실패는 세션 적용/저장 불가 상태 알림. 악보 저장 계약의 direct localStorage 금지 테스트는 이 환경설정 키만 예외로 허용.
- 4초 timeout 완전 제거. 수동 스크롤 hold는 Follow playback 클릭까지 유지; pause/resume/seek/start에서 revision 증가 제거. 명시적 toggle on만 revision으로 hold 해제. off에서는 자동 이동/복귀 버튼 모두 비활성. paused 명시적 Follow 동작 유지. 도움말 수정.
- QA typecheck/lint/build 및 rendered-html 9개 통과. /tmp/garak-follow-toggle-{build,tests}.log. git diff --check 통과. 오디오 로직 변경 없음; 단위 전체 재실행 안 함.
- 브라우저 1280×700: 토글 off→reload aria-pressed=false, 40마디 악보 m31까지 scroll0 유지. on 후 60bpm 긴 악보에서 수동 스크롤 scroll1261, m3→m6까지 같은 값/Follow playback 유지(4초 초과). Follow 클릭→scroll406/현재 m6 커서 화면에 복귀. 원본 Downloads/Drag-note-QA.garak (28).json 보관 후 열기/저장/reload 복원, viewport reset. 최종 토글 원래 기본 on 유지. 스크린샷 garak-follow-toggle.png. 실제 iPad 검증 없음. 커밋/푸시/배포 없음.

## 2026-10-14 재생 화면 추적·직접 스크롤 양보 (완료)

- 기존 매 프레임 커서 추적이 직접 스크롤을 되돌리는 문제 수정. wheel/touchmove/스크롤 키 및 실제 scroll 좌표 변화 감지 후 마지막 수동 스크롤부터 4초 동안 양보. 자동 이동의 예상 좌표를 기록해 자동 scroll 이벤트가 수동으로 오인되지 않게 처리. 이벤트/타이머 cleanup 포함.
- pause 중 자동 이동 없음. 시작/재개/seek의 playbackFollowRevision이 수동 유보 상태를 초기화. 고정 Follow playback 버튼은 수동 스크롤 중 바로 복귀하며 일시정지에서도 명시적 클릭으로만 이동. 화면에 이미 보이면 기존 nearest-scroll helper가 이동하지 않음. 큰 합주 시스템에서는 선택 스태프 높이를 추적. 도움말 갱신; 출력물에서 버튼 제외.
- QA typecheck/lint/build, unit 209개, rendered-html 9개, git diff --check 통과. /tmp/garak-follow-{build,tests,rendered}.log. 추가 화면 계약은 pause guard, manual cooldown, listener cleanup, 예상 scroll 좌표, parent 상태 전달 확인.
- 브라우저: /tmp/garak-follow.garak.json 40마디/240bpm, 1280×700. m9 scroll0 → m20 scroll379 커서 화면 내 확인. 직접 위 스크롤→scroll0/Follow playback 표시. m27 pause 후 자유 스크롤, Follow playback 클릭으로 m27 표시 복귀, pause에서 보이는 m9 클릭→m9 재생 확인. m1–12 loop 마지막 m12 scroll450 → 다음 회차 m10 scroll150로 반복/추적 유지 확인. 실물 iPad 터치는 검증하지 않음.
- 사용자 원본 Downloads/Drag-note-QA.garak (27).json 보관 후 열기/저장/reload 복원, viewport override reset. 스크린샷 기존 시각화 폴더 garak-playback-follow.png. 수정: ScoreRenderer.tsx, NotationStudio.tsx, globals.css, rendered-html.test.mjs, 이 문서. 커밋/푸시/배포 없음.

## 2026-10-14 일시정지·이어 듣기·악보 위치 이동 (완료)

- 재생 버튼/Space는 AudioContext suspend/resume로 같은 오디오 시계에서 일시정지/재개한다. playing은 활성 세션, paused는 일시정지 여부. 별도 작은 Square Stop 버튼은 세션/커서 초기화. Shift+Space 처음부터 재시작 유지. 일시정지 커서/마디 표시 유지.
- 재생/일시정지 중 음표 tap은 정확한 onset, 빈 오선 tap은 기존 마디 좌표 매핑의 16분음표 grid로 seek 후 재생. 새 큐는 기존 loop from/to와 seek offset을 유지하고 화음의 남은 sustain/셈여림 envelope를 자른다. 반복 밖 tap은 세션/범위를 유지하고 Stop 후 이동 안내. 재생 중 note drag 대신 cancellable tap/native pan 사용. 도움말/음표 접근성 안내/악보 힌트 갱신.
- 검증 중 seek 첫 80ms 커서가 직전 박자로 나타나는 문제를 찾아 elapsed 하한을 seek offset으로 고정. 기존 range tap source assertion은 playback seek가 같은 tap 경로에 합류하는 새 조건에 맞게 갱신.
- QA typecheck/lint/build 통과; unit 209개, rendered-html 8개 통과; git diff --check 통과. /tmp/garak-pause-{build,tests,rendered}.log. 추가 회귀는 3음 화음 seek 후 남은 붙임줄 duration/셈여림, 정지 시계 중복 예약 방지, 원래 반복 시작점 복귀 검사.
- localhost 실사용: /tmp/garak-pause.garak.json(4마디/60bpm/3음 화음/ties/crescendo). pause 후 장시간 커서 style 동일; Resume, pause 상태 m3 tap→재생, m1–2 loop pause/seek, loop 밖 m4 거절/범위 유지, m2 내부 이동, 빈 오선 m1 beat3 이동, Space 재개, Stop 확인. 저장/reload/download 결과 parts/ties/hairpins/tempo/measureOrder 원본과 완전 동일. 브라우저 오디오 실제 실행은 했지만 출력음 청취/녹음 및 실제 iPad 하드웨어 테스트는 하지 않음.
- 사용자 원본 Downloads/Drag-note-QA.garak (26).json 보관 후 실제 열기/저장/reload 복원. 스크린샷 기존 시각화 폴더 garak-paused-loop.png. 수정: NotationStudio.tsx, ScoreRenderer.tsx, music-core.test.ts, rendered-html.test.mjs, 이 문서. 배포/커밋/푸시 없음.

## 2026-10-14 선택 마디 재생·구간 반복·긴 곡 재생 (완료)

- Play/Space는 선택 이벤트 마디 또는 Tab 입력 마디에서 시작, 범위 선택 시 해당 시간 구간을 한 번 재생. Shift+Space는 처음부터. 범위 도구의 Loop range는 같은 구간 반복, 헤더 Stop/Space로 정지. 전체 악보/파트 보기 및 Mute/Solo 범위 유지. 도움말 갱신.
- lib/music/playback-transport.ts의 순수 큐를 추가. 기존 600개 절단 호출을 없애고 50ms 타이머가 다음 350ms 음을 예약. 끝난 oscillator/gain은 disconnect, 정지/편집/열기/unmount 시 타이머 및 context 정리. SVG 렌더 제한으로 재생을 막지 않음.
- collectPlaybackNotes의 화음/붙임줄 병합/셈여림 envelope 유지. 구간 중간의 지속음은 해당 시점 velocity로 시작, 끝 경계에서 잘라 다음 반복에서 다시 발음. 늦은 콜백은 지난 attack을 쌓지 않고 남은 sustain만 예약.
- 검증: QA 복사본 typecheck/lint/build, unit 208개, rendered-html 8개 통과. 새 회귀는 1400개 화음 음의 누락·중복 없는 예약과 구간 clipping/셈여림 보간/반복/늦은 callback 검증. /tmp/garak-playback-{build,tests,rendered}.log. git diff --check 통과.
- 브라우저: /tmp/garak-playback.garak.json(3음 화음, m1→2 붙임줄, p→f crescendo)에서 m2 시작 표시, 범위 m1–4로 ties 확장, 8초 구간보다 길게 반복 유지/커서 m2 복귀, Stop, 저장/reload 후 화음/tie 복원 확인. /tmp/garak-704.garak.json(11파트×64음) 실제 Play 704 notes → Playback finished, 콘솔 warn/error 없음. 오디오 출력을 녹음하거나 청취한 검증은 아님; 실제 Web Audio 시작/진행/종료와 큐·gain 자동 검증을 수행.
- 원본 Downloads/Drag-note-QA.garak (25).json 보관 후 실제 열기/저장/reload로 복원, 6마디와 닫힌 팔레트 확인. 스크린샷 기존 시각화 폴더 garak-range-playback.png. 수정: NotationStudio.tsx, playback-transport.ts, music-core.test.ts, rendered-html.test.mjs, 이 문서. 커밋/푸시/배포 없음. 요청 범위 미완료 없음.

## 2026-10-14 감사에서 발견한 네 문제 수정 (완료)

- 길이 변경은 붙임줄 유무와 무관하게 같은 reflow 경로를 사용한다. 일반 음표/화음/쉼표도 마디를 넘기면 정확한 길이로 분할하고 뒤 이벤트를 이동한다. 부분 변경 없이 검증 실패 시 원본 유지.
- 자동 분할에 optional event.rhythmGroupId(원본 event ID)를 저장한다. eventRhythm은 원본 ID, 시간 연속성, 화음 전체 붙임줄 연결을 확인해 자동 조각만 논리 길이로 묶는다. 수동 붙임줄/원본 ID가 없는 복사본을 임의로 합치지 않는다. 길이 편집 때 조각을 합친 후 다시 분할하며 외부 tie ID·hairpin anchor를 재연결한다. 다음 조각을 선택해도 전체 길이를 수정하고 anchor 선택으로 복귀한다. Native JSON 재개 후 유지; 기존 provenance 없는 수동 ties는 조각 편집 의미 유지.
- MusicXML measure별 slur/lyric/fermata/repeat/ending/harmony/ornaments 누락 경고를 bounded collector에 추가. 기존 경고 검토 대화상자를 통해 확인 전 악보를 교체하지 않는다.
- 팔레트 길이·점 버튼과 숫자/~ 키, 인스펙터가 같은 선택 대상/전체 길이를 사용한다. EDIT/INPUT 상태 및 Esc 안내 표시. Esc 한 번으로 팔레트를 닫고 일반 선택을 해제해 입력으로 복귀한다. 입력 음/옥타브 설정은 별도 유지.
- 실사용: 사용자 원본 25음/6마디 `Downloads/Drag-note-QA.garak (24).json` 보관. `/tmp/garak-four-fixture.garak.json`의 붙임줄 없는 둘째 화음 1→~로 마디 분할/점온음표, 저장/reload 후 m2 조각 ~로 겹점온음표→~로 온음표 확인. 팔레트 Whole 선택과 인스펙터 일치, Esc 입력 복귀 후 5는 입력 길이만 변경. 편집본 `Downloads/Rhythm-audit-QA.garak.json` 실제 열기/저장/reload 후 전체 길이 인식 확인. `/tmp/garak-four-loss.musicxml`은 네 경고 모두 표시, Cancel은 현재 악보 유지, 재열기→Open editable copy→저장/reload로 4음 확인. 마지막 원본 (24) 실제 열기/저장/reload로 복원.
- 검증: QA 복사본 typecheck/lint/build, 전체 test:unit 206개, rendered-html 8개 통과. 기존 overflow 거부 기대는 새 reflow 성공/유효성 검사로 변경, 분할 결과 기대에 provenance만 추가. 새 회귀는 일반 화음 reflow, Native 재개 후 전체 점 순환/수동 tie 보존, 누락 경고를 검사. `/tmp/garak-four-{build,tests,rendered}.log`. git diff --check 통과. 스크린샷 기존 시각화 폴더 `garak-rhythm-edit-mode.png`, `garak-import-loss-warning.png`.
- 수정 파일: lib/music/model.ts, score.ts, importers.ts, components/NotationStudio.tsx, tests/music-core.test.ts, 이 문서. 커밋/푸시/외부 배포 없음. 현재 요청 미완료 없음.

## 2026-10-14 선택 길이·점 단축키 및 마지막 Tab 생성 (완료)

- 선택 이벤트의 1–7은 온음표→64분음표 길이 변경, ~ / 백틱 / .은 해당 이벤트의 점 0→1→2→0 순환. 화음 전체에 적용하며 기존 editEventNotation 길이 재배치로 붙임줄/뒤 음 이동/마디 분할을 유지한다. 선택이 없으면 모든 입력 방식에서 입력 길이·점 설정만 변경한다. 기존 Arrow 모드 숫자 즉시 입력은 이번 요청에 맞춰 제거했고 안내도 수정했다. 키 반복 중복 편집 방지, 모달·입력필드 보호 유지.
- 마지막 마디의 Tab은 appendMeasure로 한 마디 생성·commit 후 새 마디 NEXT로 이동. Shift+Tab 이전 이동/첫 마디 포커스 탈출 유지. 일반 마디 이동은 데이터 변경 없음. 반복키·대형 악보·마디 생성 검증 한계 보호. 두 도움말/접근성 안내 갱신.
- 실사용: 원본 25개/6마디를 Downloads/Drag-note-QA.garak (22).json 보관. 선택 없이 2와 ~ 입력 시 음표25 유지/입력 dotted half만 변경. 첫 화음 3→~ 세 번으로 길이·점 순환, 4회 Undo로 원상복귀. 둘째 화음 1로 온음표를 두 붙임줄 구간에 분할; (23).json 비교/validateScore로 원래 구성음/기존 tie ID/다른 보표 보존과 정확히 2분음표만큼 총 길이 증가 확인. 저장/reload 후 마지막 마디 선택 Tab→7마디 생성→Q 입력, 두 번 Undo/Redo 및 저장/reload 확인. 최종 원본 (22) 다시 열기/저장/reload하여 25개/6마디 복원.
- QA typecheck/lint/build 및 note-input/rendered-html/music-core 151개 통과. 기존 숫자 즉시 입력·점 안내 문자열 계약만 변경된 요구에 맞게 갱신. 로그 `/tmp/garak-duration-keys-build.log`, `/tmp/garak-duration-keys-tests.log`. 브라우저 warn/error 없음, viewport 해제/도움말·메뉴 접힘. 스크린샷 `garak-duration-shortcuts.png` 기존 시각화 폴더. 변경: NotationStudio, ScoreRenderer, rendered-html 테스트, 이 문서. 미완료 없음.

## 2026-10-14 선택 음 키보드 편집·옥타브 화음·Tab 이동 (완료)

- ↑/↓는 선택된 구성음만 반음, Shift+↑/↓는 옥타브 변경. 기존 editEventNotation 기반 드래그 편집 경로를 재사용해 연결된 붙임줄 음까지 변경하고 나머지 구성음/리듬 보존. 새 shiftChromaticPitch는 반음 경계에서 자연스러운 표기를 선택하고 옥타브 변경은 임시표를 유지한다. 선택 없으면 기존 입력 음 조절. 악보 staff 이동은 Alt+↑/↓로 정리했다.
- 사용자 확인: Shift+Z/X는 현재 입력 음을 아래/위 옥타브로 선택 화음에 추가. 입력 기준 음은 유지하므로 C4 상태에서 순서대로 C3/C5를 추가한다. 기존 선택 없음/쉼표/중복 음 방어와 입력 0–8 범위를 유지.
- Tab/Shift+Tab은 악보 컨트롤에서 다음/이전 마디 NEXT 입력 위치로 이동한다. 선택을 해제하고 해당 마디에 명시적으로 입력; 가득 찬 마디는 오류를 표시하고 다른 마디로 몰래 보내지 않는다. 경계에서는 일반 Tab 포커스 이동을 허용. 마디 이동은 악보/파트/보표 범위에 묶인 임시 입력 상태다. 두 도움말 및 악보 접근성 안내 갱신, 플로팅 메뉴 자동 펼침 없음.
- 실사용 시작 원본은 이전 세션보다 늘어난 25개 음표/6마디. 새 백업 `Downloads/Drag-note-QA.garak (19).json` 보관. 연결된 D♭4 구성음 선택→↑→Shift↑로 두 음만 D5, ShiftZ/ShiftX로 C3/C5 추가. 저장/reload 및 (20).json 비교로 이벤트 수·리듬·기존 다른 음·붙임줄 보존 확인. Shift↓/↓로 연결 음 복귀, Tab/ShiftTab 위치 이동, 가득 찬 m2 입력 거부 및 m6 C4 입력을 (21).json으로 검증. 원본 (19)를 다시 열고 저장/reload하여 25개로 복원.
- 검증: QA 복사본 typecheck/lint/build, note-input/rendered-html/music-core 151개 통과. 이전 staff 화살표 안내 문자열 테스트는 새 Alt 안내에 맞춰 변경 후 통과. 로그 `/tmp/garak-edit-keys-build.log`, `/tmp/garak-edit-keys-tests.log`; git diff --check 통과. 스크린샷 기존 시각화 폴더 `garak-selected-note-keys.png`. 수정: NotationStudio, ScoreRenderer, note-input, 해당 두 테스트, 이 문서. 현재 요청 미완료 없음.

## 2026-10-14 Shift 화음 입력·Z/X 옥타브 (완료)

- `Shift+QWERTYU`는 선택한 음표/화음에 현재 입력 옥타브·임시표의 구성음을 추가한다. 기존 Chord/Next chord/Rest 모드와 독립적인 일회성 동작이며, 선택이 없거나 쉼표이면 안내 후 변경하지 않는다. 기존 정확한 대상 추가 함수를 재사용해 길이/시점/구성음/붙임줄을 유지한다. Z/X는 입력 옥타브를 0–8 범위에서 낮추고 높인다. 시스템 단축키·텍스트 입력 보호와 메뉴 접힘을 유지한다.
- 간단 도움말/전체 단축키/악보 접근성 안내와 옥타브 버튼 툴팁을 갱신했다. 수정 파일: `components/NotationStudio.tsx`, `components/ScoreRenderer.tsx`, 이 문서.
- 직접 확인: 메뉴 접힘/선택 없음 Shift+E 안내, 첫 화음 선택 후 Shift+E→X→Shift+Q→Z로 E4/C5 추가 및 입력 C4 복귀. 중복 E4 거절, Cmd+Z/Shift+Z 실행 취소/다시 실행, 저장·reload 뒤 E4/C5와 접힘 유지 확인. 내보낸 원본 (17).json과 수정본 (18).json assertion으로 오직 선택 화음에 두 음 추가, 이벤트 수/길이/시점/기존 음/붙임줄 보존 확인. 원본을 다시 열고 저장/reload하여 11개 음표로 복원했다.
- QA 복사본 typecheck/lint/build 및 note-input/rendered-html/music-core 총150개 통과. 로그 `/tmp/garak-chord-shortcuts-build.log`, `/tmp/garak-chord-shortcuts-tests.log`. git diff --check 통과, 브라우저 warn/error 없음. 도움말 화면 `garak-chord-shortcuts.png`를 기존 시각화 폴더에 저장. viewport 해제, 도움말/메뉴 접힘, 탭5 유지. 미완료 없음.

## 2026-10-14 QWERTYU 음표 입력·쉼표/임시표 단축키 (완료)

- 요청: 팔레트는 기본 접힘/직접 클릭 시 펼침을 유지하고, 1–7 음길이 선택 후 QWERTYU 도–시 입력, ~ 점음표, A 쉼표 전환, S/D/F 플랫/제자리표/샤프를 적용한다.
- 구현: `pitchFromKeyboardKey`/`PITCH_SHORTCUTS`로 QWERTYU→CDEFGAB를 연결했다. 기본 Duration→pitch 방식에서 숫자는 길이만 고르며 QWERTYU는 모든 입력 방식에서 현재 길이의 음을 입력한다. 명시적으로 선택하는 기존 Arrow→number 방식은 숫자로 즉시 입력하는 기능을 유지한다. A는 쉼표 입력을 켜고 끄며 활성화 중 QWERTYU는 쉼표를 입력한다. 메뉴 Rest도 같은 토글이며 원형 미리보기에 REST/쉼표 길이·점이 표시된다. S/D/F는 다음 입력의 임시표를 설정한다. ~, 백틱, 기존 .은 0→1→2점 순환; 키 반복은 점/모드/음 입력을 중복 적용하지 않는다. R/T 충돌을 없애 붙임줄 단축키는 백슬래시로 옮겼다. 텍스트 필드·IME 조합·시스템 단축키 보호는 유지한다. 키보드 입력으로 팔레트를 열지 않는다.
- 안내: 팔레트 도–시 키 배지와 쉼표/임시표/점/붙임줄 배지, 원형 미리보기 이름, 두 도움말, ScoreRenderer 접근성 안내를 새 배치로 수정했다. 점은 음높이 반음이 아니라 원래 음길이의 절반을 더한다.
- 실사용: 사용자 원본 11개 음표를 `Downloads/Drag-note-QA.garak (15).json`으로 보관. 접힌 상태에서 3만 누르면 음표11 유지, QWERTYU 입력 후 18개. ~ S Q로 점4분 C♭4, D W로 D♮4, F E로 E♯4, A Q로 4분쉼표, A R로 F♯4 입력. Ctrl/Cmd+S→파일 (16).json 다운로드→reload로 22개 음표와 쉼표/접힌 메뉴 유지 확인. 다운로드 파일 assertion으로 추가12이벤트의 음높이/임시표/점/쉼표 및 원본 이벤트·붙임줄 보존 검증. 이후 (15).json을 실제 파일 선택으로 재열고 브라우저 저장/reload하여 원본11개와 접힌 메뉴로 복원했다.
- 검증: QA 복사본 최종 typecheck/lint/build 및 note-input28+rendered8=36개 통과. 로그 `/tmp/garak-keyboard-build-final.log`, `/tmp/garak-keyboard-tests-final.log`. 초기 렌더링 소스 계약의 새 rest prop 누락은 기대값을 수정 후 재통과. 320px 도움말 폭296/가로 넘침 없음. 최종 브라우저 warn/error 없음, 임시 viewport 해제, 도움말·메뉴 닫힘, 탭5 유지. 실제 터치 하드웨어는 미실행.
- 변경: `NotationStudio.tsx`, `NoteEntryPreview.tsx`, `ScoreRenderer.tsx`, `lib/music/note-input.ts`, `tests/note-input.test.ts`, `tests/rendered-html.test.mjs`, 이 문서. 도움말 화면은 기존 시각화 폴더의 `garak-qwertyu-input.png`. 현재 요청의 미완료 작업 없음.

## 2026-10-14 집중 모드 (완료)

- 헤더의 패널 아이콘 옆에 Enter/Exit focus mode(최대화/복원 모양) 토글을 추가했다. 별도 행은 없으며 작은 화면/터치 영역은 44×44px이다. 389px 이하에서는 Bonifacio 링크를 File 메뉴로 옮겨 아이콘 세 개와 재생/파일 버튼이 한 줄에 들어간다.
- `useWorkspacePanelWidths`에서 일시적인 focusMode 상태로 표시만 덮어쓴다. 저장된 collapsed/preferred 너비를 수정하거나 별도로 저장하지 않으므로 해제/새로고침 시 기존 설정이 복원된다. 패널 열기나 제목·음표 편집을 명시적으로 요청하면 집중 모드를 해제하고 해당 패널을 연다. 진행 중 너비 드래그는 취소한다.
- 직접 검증: 왼쪽 열림/오른쪽 접힘 → 집중 모드로 양쪽 숨김 → 해제 후 비대칭 상태 복원. 양쪽 360px 열림 → 키보드 Enter로 켜기/끄기 후 360px씩 복원. 집중 모드 중 reload 뒤에도 저장값 360px씩 유지. 320×740에서 헤더 폭320/각 버튼44×44/악보 시작 y62, 집중 모드에서 인스펙터 열기 및 닫기 확인. 이번 턴 시작 시 사용자의 악보는 11개 음표였고 이를 그대로 유지했다. 실제 터치 하드웨어는 미실행.
- QA 복사본 typecheck/lint/build 및 rendered-html 8개 통과. 로그 `/tmp/garak-focus-build.log`, `/tmp/garak-focus-test.log`. 최종 브라우저 warn/error 없음. 초기 reload 직후 읽힌 기본 너비280/음표0은 로드 전 상태였으며 로드 완료 후 360/360과 음표11을 재확인했다.
- 마무리: viewport override 해제, 기존 양쪽 열림/360px 저장값 보존, 집중 모드를 켠 상태로 탭5 유지. 화면 `garak-focus-mode.png`는 기존 시각화 폴더에 저장했다. 변경: `NotationStudio.tsx`, `useWorkspacePanelWidths.ts`, `globals.css`, `rendered-html.test.mjs`, 이 문서. 현재 요청의 미완료 작업 없음.

## 2026-10-14 패널 버튼을 헤더 아이콘으로 이동 (완료)

- 요청: 패널 접기 버튼이 차지하던 악보 위 전용 행을 없애고, 상단 헤더의 작은 아이콘으로 옮긴다. 기존 접힘 상태·너비 저장 로직과 키는 변경하지 않았다.
- 변경: `NotationStudio.tsx`의 패널 버튼 그룹을 `header-actions`로 이동하고 글자 라벨 대신 18px 좌/우 패널 아이콘을 쓴다. 툴팁·접근성 이름·펼침 상태·키보드 포커스 복귀는 유지한다. `globals.css`에서 전용 행/캔버스 2행 레이아웃을 제거해 악보 영역이 53px 높아졌다. 데스크톱 버튼은 36px, 좁은 화면 및 coarse pointer에서는 44×44px이다. 860px 이하 새 악보/열기/저장/도움말, 620px 이하 실행 취소는 기존 File 메뉴를 사용해 헤더 한 줄을 유지한다. 저장 오류 안내는 필요할 때 헤더 아래에 띄우므로 상시 행을 차지하지 않는다.
- 검증: 1280/1101/621/320px에서 헤더 넘침 없음. 320px에서 두 버튼 44×44px, 헤더 하단과 canvas-area 상단 모두 y62. 각 패널 열기/닫기/Escape 후 헤더 아이콘 포커스 복귀, File 메뉴의 이동된 기능 접근 확인. reload 후 두 패널 접힘 유지 및 재확장 시 기존 360px씩 복원. 최종 다시 접고 reload, 7개 음표 유지, 브라우저 warn/error 없음. 실제 터치 하드웨어는 미검증이다.
- 자동 검증: QA 복사본 typecheck/lint/build 및 rendered-html 8개 통과. 기존 렌더링 계약을 헤더 아이콘 위치와 전용 행 제거에 맞춰 수정했다. 로그 `/tmp/garak-header-panels-build.log`, `/tmp/garak-header-panels-test.log`. git diff --check 통과. 너비/저장 코어는 변경하지 않아 해당 단위 테스트는 재실행하지 않았다.
- 마무리: 임시 viewport 해제, 미리보기 탭 5 유지. 화면 `/Users/cksmacbook/.codex/visualizations/2026/10/13/01a13394-4572-7673-bedf-dd913162895d/garak-header-panel-icons.png`. 변경은 `NotationStudio.tsx`, `globals.css`, `rendered-html.test.mjs`, 이 문서다. 현재 요청의 미완료 작업 없음.

## 2026-10-14 양쪽 패널 접기·펼치기와 상태 저장 (완료)

- 요청: 양쪽 패널을 버튼으로 접고 펼치며 접힘 상태를 저장한다. 다시 펼치면 조절한 너비로 돌아오고 좁은 화면에서는 악보 공간을 확보한다. 기존 미커밋 변경과 악보를 보존했으며 커밋·푸시·배포는 하지 않았다.
- 구현: `lib/panel-widths.ts`와 `useWorkspacePanelWidths.ts`에 너비와 독립적인 접힘 상태를 추가했다. `garak.instrument-panel-collapsed.v1`, `garak.inspector-panel-collapsed.v1`에 boolean을 저장한다. 접기·펼치기는 너비 저장값을 변경하지 않고, 접힌 패널은 grid 열을 차지하지 않는다. 한쪽만 보이는 상태에서 다른 쪽을 조절해도 숨긴 패널의 선호 너비를 보존한다. 양쪽을 열면 기존 악보 최소 폭 480px 제한을 적용한다. 저장 실패는 접힌 패널 밖에서도 안내한다.
- UI: 악보 위의 고정 행에 Instruments/Inspector 버튼을 두었다. 패널을 접거나 악보를 스크롤해도 다시 열기 버튼을 사용할 수 있고 최소 높이는 44px이다. 작은 화면에서는 기존 겹침 패널 방식으로 열고 닫는다. 닫기 버튼·Escape·바깥 클릭도 접힘 상태를 저장한다. 제목 편집/선택 음 편집은 접힌 인스펙터를 펼쳐 해당 필드로 이동한다. 숨긴 패널은 Tab 탐색에서 제외하며 버튼의 펼침 상태를 실제 표시 여부와 맞춘다. 중복된 모바일 헤더 악기 버튼은 고정 행 버튼으로 통합했다.
- 브라우저 검증: 1280×720에서 양쪽 360px/악보 560px → 두 패널 접기/악보 1280px → reload 후 접힘 유지 → 다시 열어 각각 360px 복원. 왼쪽을 접고 오른쪽을 직접 드래그해 420px로 변경 → 둘 다 접기/reload → 왼쪽 360px/오른쪽 420px/악보 500px 복원. 오른쪽 키보드로 360px 복귀 후 접힌 상태에서 제목 편집 및 화음 선택→Edit selection의 펼침/포커스를 확인했다.
- 반응형 검증: 1024×768에서 두 패널 접기 후 악보 폭 1024px, 320×740에서 악보와 문서 폭 320px, 두 버튼 높이 44px. 양쪽 겹침 패널 폭은 284px로 제한되며 닫기 버튼·Escape·바깥 클릭 후 열기 버튼에 포커스가 돌아왔다. 모바일 reload 이후 접힘 유지, 원래 viewport로 복귀해 두 패널을 열면 360px씩 복원됐다. 기존 7개 음표와 붙임줄 표시는 유지했다. 실제 iPad/손가락/Apple Pencil은 실행하지 않았고 작은 화면은 마우스와 키보드로 조작했다.
- 자동 검증: QA 복사본 `/var/folders/ns/8yh7k1zn3q9flcsx0msyzfhm0000gn/T/garak-ui-qa-1p26sdhd`에서 typecheck/lint/build 통과. note-input 27개(접힘 관련 3개 추가), rendered-html 8개 합계 35개 통과. 로그 `/tmp/garak-panel-collapse-{unit,rendered,build}.log`. 브라우저 최종 warn/error 없음, git diff --check 통과. 기존 번들 크기/빌드 안내는 유지한다.
- 마무리: 임시 viewport 해제, 양쪽 너비 360px를 보존하고 두 패널을 접은 상태로 reload했다. QA 개발 서버를 같은 3018 포트로 재시작했으며 최신 미리보기는 브라우저 탭 4다. 화면 `/Users/cksmacbook/.codex/visualizations/2026/10/13/01a13394-4572-7673-bedf-dd913162895d/garak-collapsible-panels.png`. 변경은 공통 훅/유틸, `NotationStudio.tsx`, `globals.css`, `note-input.test.ts`, `rendered-html.test.mjs`, 이 문서다. 현재 요청의 미완료 작업 없음.

## 2026-10-14 오른쪽 인스펙터 너비 조절·양쪽 공간 배분 (완료)

- 요청: 인스펙터도 경계선으로 너비를 조절·저장하고, 양쪽을 넓혀도 악보 공간을 확보한다. 이전 미커밋 변경과 악보를 보존했으며 커밋·푸시·배포는 하지 않았다.
- 구현: 기존 왼쪽 전용 훅/유틸을 `components/useWorkspacePanelWidths.ts`, `lib/panel-widths.ts`로 확장했다. 왼쪽 저장 키 `garak.instrument-panel-width.v1`은 그대로 읽고 오른쪽은 `garak.inspector-panel-width.v1`로 저장한다. 기본 둘 다 280px, 왼쪽 200–480px/오른쪽 240–480px. 양쪽이 나란히 있을 때 가운데 악보 480px을 먼저 확보하고, 창 축소로 두 선호 너비가 맞지 않으면 각 최소 너비 위의 여유 공간에 비례해 표시 폭만 줄인다. 다시 넓히면 저장된 선호 너비가 복원된다.
- 조작/저장: 오른쪽 경계선은 왼쪽으로 끌면 넓어지고 오른쪽으로 끌면 좁아진다. 방향키 10px/Shift 40px, Home/End, 더블클릭 기본값, 진행 중 취소 동작은 공통으로 처리한다. 직접 조절할 때 반대쪽의 표시 너비를 고정하며, 이미 창 크기에 맞춰 줄어든 상태였다면 실제 표시된 양쪽 너비를 함께 저장해 재열기 후에도 조절한 결과가 같다. 숨겨진 패널/모바일 겹침 패널의 선호 너비는 독립적으로 보존한다. 더블클릭은 일시적인 공간 제한 아래에서도 280px 선호값을 저장한다.
- UI: 인스펙터 왼쪽에 기존과 같은 경계선 손잡이/현재 너비/키보드 안내를 추가했다. 내부 `inspector-scroll`만 스크롤되게 해 손잡이가 움직이거나 잘리지 않는다. 모바일 인스펙터에도 저장값과 화면 밖 36px 여백 제한을 적용한다. 패널 포커스에서 음표 입력·삭제 단축키가 실행되지 않음을 확인했다.
- 브라우저 검증: 1280px 화면에서 왼쪽 360px을 유지하며 오른쪽 최대 440px, 악보 480px. 이후 왼쪽 확대 시도도 이 한계를 지켰다. 오른쪽 키보드 430/440/400, Home 240, End 440 및 C/Delete 후 7개 음표 유지 확인. 새로고침으로 360/440 복원. 긴 음표 편집 인스펙터를 scrollTop 361까지 내린 뒤에도 손잡이 y359..423 유지, 그 상태에서 440→380px 드래그 성공.
- 반응형/재열기: 1440px에서 양쪽 480px 설정 → 1280px에서 393/407px와 악보 480px → reload → 1440px에서 양쪽 480px 복원. 1181px의 공간 제한 아래 기본값 복귀 후 넓히면 280px 선호값 복원. 320px에서 인스펙터 최대 284px/가로 넘침 없음, 드래그로 260px 설정 → reload → 다시 열어 260px 복원. 실제 손가락/Apple Pencil 하드웨어는 미검증이며 작은 화면은 마우스로 조작했다.
- 검증: QA 복사본에서 최종 typecheck/lint/production build 통과, note-input 24개와 rendered-html 8개(합계 32개) 통과. 마지막 기본값 복귀 조정 후 typecheck/lint/build/rendered-html 재통과. 초기 상수 타입 추론과 중첩 이벤트 핸들러의 React ref 린트 지적은 명시적 number 타입/핸들러 구조 조정으로 해결했다. 최종 브라우저 warn/error 없음, git diff --check 통과. 빌드 로그 `/tmp/garak-inspector-width-build-final.log`.
- 마무리: 기존 왼쪽 설정과 같은 360px로 복원하고 오른쪽도 360px로 저장, reload 후 악보 560px/기존 7개 음표/가로 넘침 없음 확인. 임시 viewport 해제, 탭 유지. 화면 `/Users/cksmacbook/.codex/visualizations/2026/10/13/01a13394-4572-7673-bedf-dd913162895d/garak-resizable-both-panels.png`. 변경은 위 공통 훅/유틸, `NotationStudio.tsx`, `globals.css`, `note-input.test.ts`, 이 문서. 현재 요청의 미완료 작업 없음.

## 2026-10-13 왼쪽 패널 너비 조절·저장 (완료)

- 요청: Instruments 패널의 경계선을 드래그해 너비를 바꾸고 다시 열어도 유지한다. 기존 `codex` 미커밋 변경을 보존했으며 커밋·푸시·배포는 하지 않았다.
- 구현: `useInstrumentPanelWidth.ts`와 `lib/instrument-panel-width.ts`. 경계선 전체 및 중앙 손잡이에서 공통 Pointer Events로 조절한다. 기본 280px, 최소 200px, 최대 480px이며 데스크톱 악보 영역 480px/모바일 바깥 여백 36px를 확보하도록 최대값을 줄인다. 화면 크기 변화는 표시 폭만 제한하고 저장된 선호 너비를 덮어쓰지 않는다. `garak.instrument-panel-width.v1`에 완료한 드래그/키보드 변경만 저장하며 악보·팔레트 설정과 독립적이다. 잘못된 저장값은 기본값+안내, 저장 실패는 이번 방문만 적용됨을 표시한다.
- 조작: 좌우키 10px, Shift+좌우키 40px, Home/End 최소/최대, 더블클릭 280px 복귀. Escape/포인터 취소/캡처 상실/창 비활성화/창 크기 변경/추가 포인터는 진행 중 드래그를 취소하고 원래 너비를 유지한다. 키보드 포커스가 경계선에 있으면 음표 입력·삭제 단축키가 실행되지 않는다. 포커스 가능한 separator 사용은 WAI-ARIA window splitter 패턴(https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/)에 근거하며 해당 줄에만 기존 린트 규칙 예외와 이유를 남겼다.
- 실사용: localhost:3018에서 손잡이/경계선 드래그 280→360px, reload 후 360px 복원을 확인했다. 방향키 370/330, Home 200, End 480 및 C/Delete 후 기존 7개 음표 보존 확인. 900px 화면에서 패널 420px/악보 480px, reload 후 다시 1280px로 넓히면 선호 480px 복원. 320px 화면은 패널 최대 284px/가로 넘침 없음, 드래그로 240px 설정 후 reload→Open instruments로 240px 복원. 더블클릭 280px도 확인했다. 최종 360px로 조절·reload하고 임시 viewport를 해제했다. 실제 손가락/Apple Pencil 하드웨어는 미검증이며 작은 화면 조작은 마우스로 수행했다.
- 검증: 기존 QA 복사본에서 typecheck, lint, production build, note-input 22개(너비 저장/반응형/손상·실패 3개 추가), rendered-html 8개 모두 통과. 최초 lint의 비대화형 tabindex 지적은 위 표준 패턴의 좁은 예외로 처리 후 재통과. 최종 브라우저 warn/error 없음, git diff --check 통과. 빌드 로그 `/tmp/garak-panel-width-build.log`.
- 변경: `app/globals.css`, `components/NotationStudio.tsx`, 새 훅/너비 유틸, `tests/note-input.test.ts`, 이 문서. 화면 `/Users/cksmacbook/.codex/visualizations/2026/10/13/01a13394-4572-7673-bedf-dd913162895d/garak-resizable-instrument-panel.png`. 현재 요청의 미완료 작업 없음.

## 2026-10-13 범위 크레셴도·디미누엔도 / 지속음 재생 (완료)

- 요청: 여러 음표에 크레셴도·디미누엔도를 입력/수정/삭제하고, 화음·붙임줄을 보존하며 점진적으로 재생한다. 작은 화면에서 편집부터 저장/재열기를 검증한다. `codex` 브랜치의 이전 미커밋 변경을 보존했고 커밋·푸시·배포·의존성 변경은 하지 않았다.
- 데이터/명령: schemaVersion 1에 선택적인 `hairpins`를 추가해 기존 파일을 그대로 읽는다. 각 표시는 시작/끝 이벤트 ID, 방향, 시작/끝 셈여림을 저장한다. 첫 음의 시작부터 마지막 음의 끝까지이며 가장자리 쉼표는 제외한다. `setEventRangeHairpin`은 완전한 붙임줄 범위를 확장하고 닿는 기존 표시를 통째로 대체/삭제한다. 부분 선택이면 UI가 먼저 대체/삭제 범위를 안내한다. 다른 보표, 구성음, 타이, 음길이는 바꾸지 않는다. 잘못된 방향/셈여림/참조/교차 보표/겹침/쉼표 전용 범위는 원본을 보존하며 거부한다. 무효한 입력을 삭제 요청으로 오인하지 않는다.
- 기존 편집과 연동: 리듬 재배치·마디 분할 때 표시의 끝점을 마지막 분할 이벤트에 잇는다. 전체 표시를 포함한 범위 복사는 새 ID와 새 끝점으로 복사한다. 이동·조옮김은 참조를 유지하고, 끝점 음표가 삭제되면 고아 표시를 정리한다. 겹치거나 순서가 뒤집히는 이동은 유효성 검사로 거부한다. 부분 범위 복사는 완전히 포함되지 않은 표시를 새로 만들지 않는다.
- 재생: `hairpins.ts`가 보표별 시간과 셈여림 곡선을 계산한다. 범위 안에서는 From/To가 개별 셈여림보다 우선하며 끝값은 다음 표시까지 지속한다. `collectPlaybackNotes`는 붙임줄을 합친 하나의 음에 곡선 점들을 붙이고, `schedulePlaybackGain`이 실제 Web Audio gain에 선형 변화를 예약한다. 연결음을 재공격하지 않고 화음에 같은 곡선을 적용한다. 다른 보표, mute/solo, 아티큘레이션은 보존한다. 기존 MIDI 내보내기는 각 시작음의 계산된 velocity를 반영하지만 지속음 곡선을 MIDI CC로 출력하는 기능은 이번 범위에 포함하지 않았다.
- 악보/파일: 보표 아래에 벌어짐/좁아짐과 시작/끝 셈여림을 표시하고, 시스템을 넘으면 표시를 이어 그린다. 표시가 있는 악보는 보표 간 여백을 확보한다. Garak JSON은 정확한 참조를 보존한다. MusicXML은 표준 wedge start/stop과 sound dynamics(기준 velocity 90의 백분율)로 내보내고 다시 읽는다. 외부 XML의 정확한 음량이 없으면 주변 셈여림/기본 단계를 사용하고 경고한다. 지원 음표 사이가 아닌 끝점이나 겹침은 경고하며 제외한다. 근거: https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/wedge/ 및 같은 문서의 direction/sound.
- UI/실사용 개선: 범위의 `Cresc. / dim.` 탭에 방향, From/To, Apply/Update, Remove를 추가했다. 반대 방향의 셈여림이면 적용을 비활성화하고 이유를 알린다. 작은 화면에서 펼친 패널이 악보를 가리는 문제를 직접 확인해 Hide tools/Edit range를 추가했고, 성공적인 적용/삭제 뒤 선택 요약만 남기고 해당 버튼으로 포커스를 옮긴다. 320px에서 방향 버튼이 패널 여백을 침범한 문제도 수정했다. 실제 측정: 버튼/셀렉트 모두 높이 44px, x23..297, 패널 오른쪽310, 문서 너비320. 팔레트 위치 설정은 그대로 보존한다.
- 직접 브라우저 검증: 원본 `Drag note QA`를 `Downloads/Drag-note-QA.garak (13).json`으로 먼저 보관했다. 붙임줄 화음2개에 p→f 입력, 390×844에서 ff→pp로 방향/음량 변경, m.3 D5까지 확장해 pp→ff로 대체, 재생 시작/완료, 표시 삭제, Undo 복원, 일부 범위 선택 시 대체/삭제 안내, 잘못된 ppp 끝값의 적용 차단을 확인했다. 브라우저 저장/reload, 실제 native 파일 다운로드→표시 삭제→파일 선택 재열기, MusicXML 다운로드/파일 선택 재열기까지 완료했다. 표시2조각으로 시스템 경계를 잇는 화면과 태블릿1024×768 편집 화면을 확인했다.
- 실제 파일 검사: `Downloads/Drag-note-QA.garak (14).json`, `Downloads/Drag-note-QA (5).musicxml`. 원본의 parts/ties가 native와 완전히 같고, native/XML 유효성 오류 및 XML 경고가 없다. pp→ff 범위는 tick0..8640. 재생 6회 시작, D♭4 붙임줄은 2.5초의 한 음이며 그동안 velocity44→74.2222로 증가한다. 두 파일의 모든 음높이/시작/길이/velocity/envelope가 일치한다. CUA가 오디오를 청취한 것은 아니며 재생 UI와 실제 gain 예약의 회귀 검사를 구분한다.
- 검증: QA 복사본 `/var/folders/ns/8yh7k1zn3q9flcsx0msyzfhm0000gn/T/garak-ui-qa-1p26sdhd`에서 관련154개 통과 후 production build 포함 전체 **210/210 통과** (`/tmp/garak-hairpin-full-test-final.log`). 신규5개 회귀는 CRUD·연결화음·지속음 gain·파일 왕복·재배치/복사·검증 오류를 포함한다. 첫 전체 검사209/210에서 이전 gain 코드 위치를 확인하던 소스 계약 테스트가 실패해 추출된 함수/실제 호출에 맞게 갱신했다. 마지막 모바일 CSS 수정 후 build+rendered8개 재통과, 최종 typecheck/lint도 통과 (`/tmp/garak-hairpin-{build,rendered,typecheck,lint}-final.log`). 기존 번들 크기/빌드 도구 경고는 유지. 브라우저 warn/error는 없음.
- 마무리/한계: `(13).json`을 실제 파일 선택으로 복원하고 Saved locally 확인, 표시 개수0/원본 화음과 붙임줄 확인, 임시 viewport 해제, 미리보기 탭 유지. 실제 iPad/Safari/Apple Pencil·손가락 터치 하드웨어는 미실행. 반응형 화면의 직접 마우스/키보드 조작과 기존 공통 Pointer Events 검사로 확인했다. 사용자 도움/외부 승인이 필요한 작업은 수행하지 않았다.
- 화면 증거: `/Users/cksmacbook/.codex/visualizations/2026/10/13/01a13394-4572-7673-bedf-dd913162895d/garak-range-hairpin-tablet.png`, 같은 폴더 `garak-range-hairpin-mobile.png`.
- 이번 변경: model/score/exporters/importers, 새 `lib/music/hairpins.ts`·`playback-gain.ts`, 새 `components/RangeHairpinControls.tsx`, NotationStudio/ScoreRenderer/globals.css, music-core/rendered-html 테스트, 이 문서. 다음 작업은 새 요청 범위로 진행한다.

## 2026-10-13 범위 셈여림·아티큘레이션 / 팔레트 위치 저장 (완료)

- 요청: 범위로 선택한 여러 음표의 셈여림·아티큘레이션을 일괄 변경하며 화음·붙임줄을 보존한다. 작은 화면에서 편집/저장/재열기를 직접 확인하고 팔레트 위치를 다시 열 때 복원한다. 기존 미커밋 변경을 보존했고 커밋·푸시·배포·의존성 변경은 없다.
- 코어: `setEventRangeExpression`은 기존 `prepareEventRange`로 같은 보표/성부의 연속 범위와 완전한 붙임줄 묶음을 포함한다. 셈여림은 선택한 음표/쉼표, 아티큘레이션은 선택한 음표/화음에 적용하며 쉼표는 건너뛴다. null은 해당 표시만 제거한다. ID·구성음·음높이·음길이·박자 위치·붙임줄·다른 보표는 보존한다. 잘못된 값/범위/원본은 부분 변경 없이 거부하며 이미 같은 값이면 원본을 반환한다. 현재 적힌 이벤트마다 표현을 적용하고, 연결음 재생은 기존처럼 하나의 시작음에 귀속되어 재공격하지 않는다. 셈여림은 다음 표시까지 이어지는 기존 악보 의미를 유지한다.
- UI: 범위의 Expression에 Dynamic(ppp–fff)/Articulation(staccato, tenuto, accent, marcato)/No mark를 추가했다. 현재 값이 다르면 Mixed를 표시하고 적용 후 같은 범위를 유지한다. 하나의 변경은 Undo 한 단계다. 작은 화면에서 막대가 계속 커지지 않게 Pitch/Length/Expression 중 한 도구를 표시한다. 이동/복사 목적지 선택 중 편집 도구를 감춘다. 표현 제거/쉼표 처리/셈여림 지속 의미를 안내하며 Inspector는 기존 단일 음 조작 대신 범위 도구를 안내한다.
- 팔레트 저장: `garak.note-dock.v1`에 작업 영역 대비 상대 좌표를 별도로 저장한다. 정상 종료한 드래그·키보드 이동·초기화만 저장하며 취소된 드래그는 저장하지 않는다. 화면 크기/방향이 바뀌면 비율로 복원하고 화면 안으로 제한한다. 초기화는 null을 저장해 다음 방문에도 기본 오른쪽 아래로 시작한다. 잘못된 값/저장 실패는 화면에 안내하며 악보 저장 키를 건드리지 않는다. 악보 파일에 팔레트 설정을 넣지는 않는다.
- 직접 발견/수정: 복원 직후 기본 위치에 잠깐 보인 원형 버튼을 누르면, 버튼이 저장 위치로 이동하는 사이 뒤의 D5가 선택되는 현상을 재현했다. 저장 좌표와 작업 영역 크기를 읽을 때까지 버튼을 숨겨 안정된 위치에서 한 번에 표시하도록 수정했다. 같은 재열기→즉시 열기 흐름에서 메뉴 열림/선택 음 없음으로 재검증했다. 모바일 범위의 D5를 자동 스크롤하는 도구가 고정 막대 뒤로 맞추는 경우에는 실제 보이는 좌표를 눌러 범위를 확장했다. 실제 손가락 스와이프는 실행하지 않았다.
- 브라우저 흐름: 원본 `Drag note QA`를 `Downloads/Drag-note-QA.garak (11).json`으로 먼저 보관. 연결 화음2개에 p/staccato→m.3 D5까지 확대 시 Mixed 확인. 390×844에서 ff/accent→아티큘레이션 제거→Undo로 accent 복원, 재선택/직접 클릭으로 범위 확대, 셈여림 제거/재적용 및 tenuto 대체, Length/Expression 전환을 확인했다. 브라우저 저장/reload 후 native 다운로드, 일부 화음을 pp/marcato로 바꾼 뒤 파일 선택 재열기로 ff/tenuto 복원을 확인했다. MusicXML도 실제 다운로드/파일 선택 재열기 완료.
- 실제 파일 검증: `Downloads/Drag-note-QA.garak (12).json`, `Downloads/Drag-note-QA (4).musicxml`. m.1 half 화음[C4,D♭4,F4]/[C4,D♭4,G4], m.3 quarter D5의 3개 이벤트 모두 ff/tenuto. 원본 붙임줄1개와 ID·음높이·길이·박자·낮은 보표 유지, native/XML 유효성 오류 없음/XML 경고 없음, 재생 음높이·시작·길이·velocity·아티큘레이션 일치를 실제 다운로드 파일로 assertion했다.
- 위치 실사용: 390×844에서 원형 버튼을 이동한 뒤 reload 전후 x24/y320 일치. 320×740에서 복원/펼치기 후 팔레트 x12..308, 문서 폭320으로 넘침 없음. 1024×768에서 Home 초기화→reload로 기본 위치 복원. 다시 이동 후 reload 전후 x252/y626 일치, 그 위치에서 옆으로 펼쳐지는 화면을 저장했다.
- 검증: 기존 QA 복사본 `/var/folders/ns/8yh7k1zn3q9flcsx0msyzfhm0000gn/T/garak-ui-qa-1p26sdhd`에서 관련128개/typecheck/lint 통과 후 build 포함 전체 **205/205 통과** (`/tmp/garak-expression-full-test.log`). 코어4개/위치 저장3개 신규 회귀와 범위/드래그 UI 계약 보완. 마지막 복원 위치 깜빡임 수정 뒤 typecheck/lint/build 및 rendered8개 재통과 (`/tmp/garak-expression-typecheck-final.log`, `/tmp/garak-expression-lint-final.log`, `/tmp/garak-expression-build-final.log`, `/tmp/garak-expression-rendered-final.log`). Hook 상태 추가 시 개발 서버 HMR의 hook 순서 오류 로그가 남았으나 reload로 해소됐고 최종 새 로드 이후 warn/error 없음. 기존 빌드 번들 크기 경고는 유지한다.
- 마무리: `(11).json`을 실제 재열어 원본 복원/Saved locally 확인, 팔레트 초기화 저장, 임시 viewport 해제, 최종 reload 확인. 미리보기 탭 유지. 변경 소스/테스트8개는 QA 복사본과 일치하고 git diff --check 통과.
- 화면 증거: `/Users/cksmacbook/.codex/visualizations/2026/10/13/01a13394-4572-7673-bedf-dd913162895d/garak-range-expression-tablet.jpg`, 같은 폴더 `garak-palette-position-restored.jpg`.
- 한계: 실제 iPad/Safari/Apple Pencil/손가락 터치는 미실행. 검증은 반응형 화면의 직접 마우스/키보드 조작과 공통 Pointer Events 경로에 대한 테스트다. 위치는 같은 브라우저에 저장되며 기기 간 동기화 대상은 아니다.
- 변경: `lib/music/score.ts`, `lib/floating-dock.ts`, `components/useFloatingNoteDock.ts`, `components/NotationStudio.tsx`, `app/globals.css`, `tests/music-core.test.ts`, `tests/note-input.test.ts`, `tests/rendered-html.test.mjs`, 이 문서. 다음 작업은 새 요청 범위를 기준으로 진행한다.

## 2026-10-13 범위 음길이·점 일괄 변경 / 정렬·이동 가능한 팔레트 (완료)

- 요청: 선택한 여러 음표를 ×2/÷2로 늘이거나 줄이고 점을 일괄 적용한다. 화음·붙임줄·마디 경계를 유지하며 저장/재열기를 직접 확인한다. Length 1–7과 Note 도–시의 열을 맞추고, 기본 오른쪽 아래의 팔레트를 자유롭게 이동한다. 기존 미커밋 변경을 보존했고 커밋·푸시·운영 배포·새 의존성은 없다.
- 코어: `changeEventRangeDuration`은 같은 보표의 연속 범위를 기존 `prepareEventRange`로 확장해 연결된 화음/붙임줄을 포함한다. ×2/÷2는 음표·명시적 쉼표와 범위 내부의 빈 시간을 함께 바꾼다. 점0/1/2는 **현재 적힌 각 음표·쉼표 조각의 기본 음길이**에 적용한다. 뒤의 음을 밀거나 당기며 박자표에 맞춰 다시 배치하고, 마디를 넘는 화음은 구성음마다 붙임줄을 만든다. 기존 연결은 분할 마지막 조각에 다시 잇는다. 첫 조각의 ID·표현과 다른 보표를 보존하며 필요한 마디를 추가한다. 뒤쪽의 기존 빈 마디는 삭제하지 않는다. 64분음표보다 작은 단위로 정확히 표현할 수 없거나 선택/점/배율이 유효하지 않으면 원본 그대로 거부한다.
- 범위 UI: Length ÷2/×2, Dots Apply… → No dots/1 dot/2 dots를 추가했다. 한 번의 적용은 Undo 한 단계이고 새 분할 조각까지 선택 상태를 유지한다. 목적지 선택 중에는 길이 도구를 감추고 선택이 없으면 비활성화한다. 뒤의 음도 이동하며 점은 적힌 조각마다 적용된다는 안내를 막대·도움말에 반영했다.
- 팔레트: Length와 Note가 같은 가로 스크롤 영역을 쓰며 일곱 버튼의 44px 폭/4px 간격/라벨 폭을 통일했다. 긴 붙임줄 버튼은 정사각 아이콘으로 줄였다. 넓을 때 두 줄+오른쪽 보조 도구, 좁을 때 세 줄을 유지하되 분기 기준은 실제 팔레트 폭1144px이다. 320px에서 발견한 Length 라벨의 min-content 폭 차이(0.828px)는 min-width:0으로 고쳐 모든 열의 x좌표가 일치한다.
- 이동: 새 `useFloatingNoteDock`/`floating-dock`은 원형 버튼 또는 이동 손잡이의 Pointer Events(mouse/touch/pen)로 위치를 바꾼다. 6px 미만은 탭으로 유지하고 드래그 뒤 클릭은 억제한다. 펼쳐질 방향은 남은 공간으로 결정하고 악보 작업 영역 안에 들어오도록 제한한다. 도움말도 위/아래 공간에 맞게 배치한다. 포인터 취소/캡처 상실/다중 입력/Escape/blur/resize는 이동을 취소한다. 손잡이 방향키20px, Shift+방향키60px, Home 및 초기화 아이콘으로 오른쪽 아래 복귀. 위치는 현재 페이지 상태이며 새로 열면 기본 위치다.
- 직접 사용: 원본 `Drag note QA`를 `Downloads/Drag-note-QA.garak (9).json`으로 먼저 보관했다. 붙임줄로 연결된 화음2개를 범위 선택해 ×2/÷2 왕복, 1 dot 적용과 마디 경계 분할을 확인했다. 390×844에서 범위를 다시 선택하고 2 dots 적용→Undo 한 단계 복구→브라우저 저장/reload를 수행했다. 실제 Garak 다운로드 후 길이를 바꾸고 파일 선택으로 재열어 복원했고, MusicXML도 다운로드/파일 선택 재열기 완료. 마지막에는 `(9).json` 원본을 실제로 다시 열고 Saved locally를 확인했다.
- 실제 저장 검증: `Downloads/Drag-note-QA.garak (10).json`, `Downloads/Drag-note-QA (3).musicxml`. m.1 tick0 dotted-half [C4,D♭4,F4], tick2880 quarter [C4,D♭4,G4], m.2 tick0 half [C4,D♭4,G4], m.3 tick1920 quarter D5. 기존 붙임줄 ID를 포함한4개 연결/낮은 보표 동일/유효성 오류 없음/XML 경고 없음/재생 음높이·시작·길이 동일을 실제 다운로드 파일로 assertion했다. D♭4 연결 길이6박, D5 시작10박/길이1박.
- 화면 검증:1800×900/1024×768/390×844/320×740. 원형 버튼 드래그 뒤 접힌 상태 유지→탭으로 옆 펼치기, 열린 팔레트의 손잡이 이동, 도움말의 아래 배치, 키보드 이동/Home/초기화 확인. 320px에서 멀리 있는 길이 버튼을 선택해 스크롤된 상태에서도 두 줄7칸의 x좌표가 동일하고 문서 가로 넘침 없음. 실제 스와이프/물리 iPad·Safari·Apple Pencil·손가락 터치는 미실행이며 반응형 화면 마우스 조작과 공통 입력 처리 검증으로 구분한다.
- 자동 검증: 기존 QA 복사본 `/var/folders/ns/8yh7k1zn3q9flcsx0msyzfhm0000gn/T/garak-ui-qa-1p26sdhd`에서 전체 **198/198 통과** (`/tmp/garak-rhythm-full-test.log`). 신규 코어4개/배치 계산1개/렌더링 입력 계약1개 포함. 최종 라벨 폭·pointer capture 취소 보완 뒤 typecheck/lint/production build 및 rendered8개 재통과 (`/tmp/garak-rhythm-typecheck-final.log`, `/tmp/garak-rhythm-lint-final.log`, `/tmp/garak-rhythm-final-build.log`, `/tmp/garak-rhythm-final-rendered.log`). 기존 번들 크기·Node 경고는 유지한다. 변경 소스/테스트8개가 QA 복사본과 일치하며 git diff --check 통과. 최종 브라우저 warn/error 없음, viewport 해제, 팔레트 기본 위치 복원, 미리보기 탭 유지.
- 화면 증거: `/Users/cksmacbook/.codex/visualizations/2026/10/13/01a13394-4572-7673-bedf-dd913162895d/`의 `garak-range-rhythm-tablet.jpg`, `garak-aligned-draggable-palette.jpg`, `garak-moved-palette.jpg`.
- 변경: `lib/music/score.ts`, `lib/floating-dock.ts`, `components/useFloatingNoteDock.ts`, `components/NotationStudio.tsx`, `app/globals.css`, `tests/music-core.test.ts`, `tests/note-input.test.ts`, `tests/rendered-html.test.mjs`, 이 문서. 다음 작업은 새 요청의 범위와 현재 파일을 기준으로 진행한다.

## 2026-10-13 범위 반음·옥타브 조옮김 / 반응형 두 단 팔레트 (완료)

- 요청: 범위로 선택한 여러 음을 반음·옥타브 단위로 일괄 조옮김하고 화음 음정/붙임줄을 유지한다. 선택·수정·저장·재열기를 직접 확인한다. 넓은 팔레트는 왼쪽 Length/Note 두 줄, 오른쪽 보조 도구로 배치하고 좁으면 세 줄로 표시한다. 기존 수정 보존, 커밋·푸시·배포·의존성 변경 없음.
- 코어: `transposeEventRange`는 ±1/±12반음을 지원하고 기존 `prepareEventRange`로 완전한 붙임줄 범위를 포함한다. 전체 음에 같은 반음 간격과 음이름 이동량을 적용해 실제 소리 간격과 표기된 화음 음정을 함께 보존한다. 옥타브 이동은 음이름/임시표를 유지한다. 반음 이동은 모든 음에 적용 가능한 공통 표기 중 임시표 부담이 적은 것을 선택하며 이명동음 구성음을 합치지 않는다. ID/붙임줄/음길이/표현/다른 보표/조표를 유지한다. 옥타브 -1..9 또는 임시표 -2..2 범위를 넘거나 선택이 유효하지 않으면 부분 변경 없이 원본을 반환한다. 쉼표만 선택하면 변경 없음.
- UI: 범위 막대에 Pitch −1 octave / −1 semitone / +1 semitone / +1 octave 버튼을 추가했다. 한 번 누를 때 Undo 한 단계이며 적용 후 범위를 유지해 연속 조작할 수 있다. 목적지 선택 중에는 조옮김 도구를 감추며, 범위/음이 없으면 비활성화한다. 도움말/Inspector/선택 상태 안내에 조옮김을 반영했다. 범위에서 입력 팔레트로 전환할 때 해제된 범위의 옛 안내가 남는 문제를 직접 발견해 현재 입력 방식 안내로 바꾸었다.
- 팔레트: 실제 악보 작업 영역을 기준으로 container 1180px 이상에서 왼쪽 Length/Note+옥타브, 오른쪽 Entry/임시표/점/붙임줄/편집/입력 방식을 배치한다. DOM 순서와 키보드 순서는 유지한다. 양쪽 첫 줄/둘째 줄 버튼의 세로 위치를 맞췄다. 1800×900 화면에서는 높이130px, 1660×900 전환 경계에서는 오른쪽 보조 도구가 세 줄로 감겨 높이174px이다. 좁으면 기존180px 세 줄로 돌아간다. 원형 버튼 왼쪽12px/하단 정렬/위쪽 도움말/44px 버튼을 유지했다.
- 브라우저 사용: `Drag note QA`를 먼저 `Downloads/Drag-note-QA.garak (7).json`으로 보관. 붙임줄 화음2개와 m.3 D5를 범위로 선택해 반음 위/아래, 옥타브 위/아래 왕복을 확인했다. 모바일390×844에서 첫/마지막 음을 다시 선택하고 +1반음, +1옥타브를 연속 적용했다. Undo 한 번은 옥타브만 되돌리고 File의 Redo로 재적용했다. 브라우저 저장/reload로 복구하고 실제 native 다운로드 후 음을 반음 내려 바꾼 다음 파일 재열기로 저장된 음높이 복원을 확인했다. MusicXML도 다운로드/파일 선택 재열기 완료.
- 실제 저장 파일: `Downloads/Drag-note-QA.garak (8).json`, `Downloads/Drag-note-QA (2).musicxml`. 7개 구성음 모두 원본 대비 정확히 +13반음이며 원본 note ID/붙임줄1개/음길이·박자 위치/낮은 보표가 유지됨을 assertion으로 확인했다. 최종 화음은 [C♯5,D5,F♯5]/[C♯5,D5,G♯5] half2개, m.3 D♯6 quarter. native/XML 문서 유효성, XML 경고 없음, 재생 음높이·시작·길이 동일 확인.
- 검증: 기존 QA 복사본에서 typecheck/lint/build 및 전체 **192/192 통과**, 조옮김 코어4개(연결 화음·표현·왕복, 옥타브 표기, 이명동음/경계, 원자적 거부/쉼표) 포함 코어101개. 최종 안내 전환/정렬 조정 뒤 typecheck/lint/build/rendered7개 재통과. 로그 `/tmp/garak-transpose-full-test.log`, `/tmp/garak-transpose-typecheck-final.log`, `/tmp/garak-transpose-lint-final.log`, `/tmp/garak-transpose-final-build.log`, `/tmp/garak-transpose-final-rendered.log`. 테스트 작성 중 articulation 필드 오타와 배열 추론 타입 오류를 수정한 후 재검증했다. 기존 번들 크기/Node deprecation 경고는 남는다.
- 화면:1800×900,1660×900,1024×768,390×844,320×740. 320px에서 조옮김4개 버튼이 모두 화면 안에 있고 문서 가로 넘침 없음. 1024px 팔레트696×180px/3줄, 넓은 팔레트의 양쪽 버튼 y위치 일치/열 내부 넘침 없음. 증거 폴더 `/Users/cksmacbook/.codex/visualizations/2026/10/13/01a13394-4572-7673-bedf-dd913162895d/`: `garak-range-transpose-tablet.jpg`, `garak-responsive-palette-wide.jpg`, `garak-responsive-palette-tablet.jpg`, `garak-responsive-palette-mobile.jpg`.
- 마무리: 원본 `(7).json`을 실제 파일 선택으로 복원하고 Saved locally 확인. 임시 viewport 해제, 최종 브라우저 warn/error 없음. 새 팔레트를 열어 둔 검증 탭 유지. 코드/테스트는 검증 복사본과 일치한다.
- 한계: 같은 보표의 연속 범위에 적용한다. 실제 iPad/Safari/Apple Pencil/손가락 터치는 미실행이며 반응형 화면의 마우스 조작과 공통 Pointer Events 테스트로 구분한다. 승인 필요한 운영 작업은 보류한다.
- 변경: `lib/music/score.ts`, `components/NotationStudio.tsx`, `app/globals.css`, `tests/music-core.test.ts`, `tests/rendered-html.test.mjs`, 이 문서.

## 2026-10-13 음표 범위 선택·일괄 편집·팔레트 정돈 (완료)

- 요청: 여러 음표를 범위로 선택해 이동·복사·삭제하고 화음/붙임줄을 유지한다. 작은 화면에서 선택·수정·저장·재열기를 직접 확인하고 팔레트의 음표 크기와 시각적 일관성을 개선한다. 기존 미커밋 수정 보존. 커밋·푸시·배포·의존성 변경 없음.
- 코어: `getEventRange`, `moveEventRangeToPosition`, `copyEventRangeToPosition`, `clearEventRange` 추가. 같은 보표의 처음/끝 이벤트 사이를 시간순으로 선택한다. 화음의 어느 구성음에서든 붙임줄을 따라 범위를 전이적으로 확장하며 사이의 쉼표와 빈 마디 시간도 유지한다. 이동은 원래 자리를 쉼표로 채우고, 복사는 이벤트/구성음/붙임줄에 새 ID를 부여한다. 마디 경계 분할·박자표 변경·마디 확장 및 기존 표현 보존은 단일 이동과 공통 경로를 사용한다. 다른 음/보존할 쉼표 셈여림과 충돌하면 원본 그대로 거부한다. 삭제는 같은 길이의 쉼표로 바꾸고 해당 연결만 제거한다.
- 선택 UI: 악보 위 Select range → 첫 음/쉼표 → 마지막 음/쉼표. Shift+클릭, Shift+좌우키로도 확장한다. 선택 범위를 단마다 강조하고 개수·마디·붙임줄 자동 확장을 안내한다. Move/Copy 뒤 같은 보표에서 목적 박을 누르면 적용한다. 선택/목적지 모드에서 개별 음 드래그는 꺼지고 음 위에서 시작한 스와이프도 스크롤할 수 있다. 포인터 취소·다중 입력·스크롤/변경 중 탭 취소를 유지한다. Escape는 목적지 선택을 먼저 취소하고, 다음에는 범위를 해제한다. 각 일괄 편집은 Undo 한 단계다.
- 직접 발견한 불편 개선: 아래쪽 마디를 선택한 뒤에도 조작할 수 있도록 범위 막대를 악보 스크롤 영역 상단에 고정했다. Shift+방향키로 이동한 음이 그 막대 뒤에 가려지지 않도록 스크롤 계산에 막대 높이를 반영했다. 모바일 상단에도 Undo를 노출하고 File 메뉴에 Undo/Redo를 추가했다. 범위 선택 중에는 단일 음 편집 필드 대신 해당 조작 안내를 표시한다.
- 팔레트: 24px SVG 음표 아이콘과 44px 버튼으로 통일하고 길이에 1/4·1/8 등의 숫자를 추가했다. 음이름·옥타브·라벨·단축키·선택색·경계·간격을 정돈했다. 원형80px 버튼 왼쪽12px 간격, 하단 정렬, 높이180px의 Length / Note+Octave / Entry+Accidental 세 줄은 유지한다. 물음표는 원형 바로 위에 유지하고 Add notes 제목은 없다. 좁은 화면은 각 행을 가로 스크롤한다.
- 브라우저 검증: 기존 `Drag note QA`를 `Downloads/Drag-note-QA.garak (3).json`으로 먼저 보관했다. 원본의 붙임줄 화음2개와 m.3의 D5를 범위로 선택→복사→원본 위로 겹치는 이동 거부→삭제→Undo 복원→복사본을 m.5 beat3로 이동했다. 모바일390×844에서 원본 범위를 삭제/Undo하고 m.2로 이동했다. 복사본의 D♭4를 Natural로 바꾸어 연결된 두 음만 D4가 되고 원본 D♭4는 유지되는 것을 확인했다. Shift+클릭/방향키 선택과 고정 막대 아래 선택 음 표시도 확인했다.
- 저장/재열기: 브라우저 저장→reload 복구, 실제 Garak 다운로드/파일 선택 재열기, 실제 MusicXML 다운로드/파일 선택 재열기 완료. 최종 `Downloads/Drag-note-QA.garak (6).json`, `Downloads/Drag-note-QA (1).musicxml`. 원본은 m.2 tick0/1920 half 화음[C4,D♭4,F4]/[C4,D♭4,G4], m.4 tick0 quarter D5. 복사본은 m.5 tick1920 / m.6 tick0 half 화음[C4,D4,F4]/[C4,D4,G4], m.7 tick1920 quarter D5. 원본 ID 유지/복사본 ID 분리/타이2개/낮은 보표 음 없음/문서 유효성/native와 XML 음높이·시작·길이 동일을 실제 다운로드 파일로 검사했다.
- 자동검증: 기존 QA 복사본 `/var/folders/ns/8yh7k1zn3q9flcsx0msyzfhm0000gn/T/garak-ui-qa-1p26sdhd`에서 typecheck, lint, production build 및 전체 **188/188 통과**. 범위 코어 회귀6개 포함 코어97개, rendered7개. 로그 `/tmp/garak-range-full-test-final.log`, `/tmp/garak-range-typecheck-final.log`, `/tmp/garak-range-lint-final.log`. 마지막 글자 크기 CSS 조정 후 build와 rendered7개 재통과 (`/tmp/garak-range-css-build.log`, `/tmp/garak-range-css-rendered.log`). 기존 번들 크기/Node deprecation 경고는 남는다.
- 화면:1024×768에서 팔레트 SVG24px/버튼44px, 320×740에서 팔레트204×180px/버튼44px/문서 가로 넘침 없음/헤더 버튼 화면 내 배치 확인. 화면 증거는 `/Users/cksmacbook/.codex/visualizations/2026/10/13/01a13394-4572-7673-bedf-dd913162895d/`의 `garak-range-selection-tablet.jpg`, `garak-refined-palette-tablet.jpg`, `garak-refined-palette-mobile.jpg`.
- 마무리: 보관한 원본 `(3).json`을 UI 파일 선택으로 복원하고 Saved locally 확인. 임시 viewport 해제, 최종 브라우저 warn/error 없음. 복원된 원본과 새 팔레트를 보여 주는 검증 탭을 deliverable로 남겼다.
- 한계: 한 번에 같은 보표의 연속 범위를 처리한다. 실물 iPad/Safari/Apple Pencil·손가락 터치 실기기 검증은 미실행. 화면 크기를 바꾼 마우스 직접 조작 및 touch/pen 공통 Pointer Events 테스트와 구분한다. 승인 필요한 운영 반영 등은 계속 보류한다.
- 변경: `lib/music/score.ts`, `components/ScoreRenderer.tsx`, `components/NotationStudio.tsx`, `components/DurationIcon.tsx`, `app/globals.css`, `tests/music-core.test.ts`, `tests/rendered-html.test.mjs`, 이 문서.

## 2026-10-13 좌우 박자 이동·버튼 옆 3줄 팔레트 (완료)

- 요청: 좌우 드래그로 박·마디 이동, 화음/붙임줄 유지, 입력·수정·저장·재열기 직접 확인. 메뉴는 원형 버튼 **왼쪽 옆**에 펼치며 Add notes 제목 제거, Length / Note+옥타브 / Entry+Accidental 등 3줄. 기존 미커밋 변경 보존. 커밋·푸시·배포·권한/의존성 변경 없음.
- 코어: `getEventMoveGroup` / `moveEventToPosition`으로 같은 보표의 화음 전체와 붙임줄로 연결된 이벤트를 같은 절대 tick 차이만큼 이동. 구성음별 연결을 따라 전이적으로 묶는다. 원래 자리는 쉼표로 채우고 다른 음의 시간은 보존한다. 목적지 쉼표/빈 공간만 소비하며 다른 음과 겹치거나 쉼표의 셈여림 표시를 지우는 이동은 원본 그대로 거부한다. 마디 경계에서는 정확한 음가로 분할하고 구성음별 연결, 기존 ID/표현을 보존한다. 필요한 마디 추가 및 박자표 변경을 처리하며 표현할 수 없는 길이는 반올림하지 않는다.
- 입력: 처음 약6 CSS px의 방향으로 좌우 시간 이동 / 상하 음높이 편집을 고정한다. 실제 VexFlow 박별 간격을 역산해 16분음표 간격 또는 기존 시작점에 맞춘다. 어긋난 화음 머리에서도 잡은 위치를 유지한다. 같은 보표의 다른 단 이동 가능. 미리보기는 마디/박을 표시하며 release에서만 한 번 commit한다. Escape, pointercancel, 다중 포인터, scroll/resize, 악보 변경 시 취소. 선택 변경은 release로 유지한다. 도움말/오선 안내/접근성 이름도 갱신.
- 메뉴: 원형80px 버튼 왼쪽에12px 간격, 하단 정렬. 높이180px의 세 줄이며 Add notes 및 중복 설명행 제거. 첫 줄 Length/닫기는 고정, 음가만 가로 스크롤. 둘째 줄 Note/음높이/옥타브, 셋째 줄 Entry/Accidental/점/붙임줄/입력 방식 등 각각 가로 스크롤. 물음표44px는 원형 바로 위. 좁아도 위쪽 펼침으로 전환하지 않는다. 모바일 상태 알림이 메뉴를 가리는 실제 문제를 발견해 열린 메뉴 위12px로 옮겼다. 참고: Apple Pencil 도구 팔레트 공식 안내 https://support.apple.com/en-bh/guide/ipad/draw-with-apple-pencil-ipadc55b6c7a/ipados (Pencil squeeze 자체는 구현하지 않음).
- 직접 사용: 기존 사용자 수정본 `Drag note QA`를 `/Users/cksmacbook/Downloads/Drag-note-QA.garak (2).json`에 보관. 새 `Timeline move QA`에 C4/E4/G4 half 화음2개를 버튼으로 입력하고 E4 연결. 첫 화음을 잡아 둘을 m.2 beat1로 이동, Undo/Redo, m.3의 D4에 겹치는 이동 거부 확인. D4를 m.3 beat3.25로 이동하고 화음 그룹을 m.2 beat2로 옮겨 m.3까지 분할 확인. 연결 E4를 수직 드래그해 세 조각의 A4만 수정, C4/G4 유지. 태블릿1024×768에서 D4를 m.4 beat2.75로 이동.
- 저장/재열기: 브라우저 저장/reload 복구, 실제 Garak 파일 다운로드·재열기, MusicXML 다운로드·재열기, 태블릿 이동 후 다시 Garak 저장·재열기 완료. `Timeline-move-QA.garak.json`, `Timeline-move-QA.musicxml`, `Timeline-move-QA.garak (1).json`은 Downloads에 있다. 최종 파일 assertion: m.2 tick960 half[C4,A4,G4], tick2880 quarter같은화음, m.3 tick0 quarter같은화음, m.4 tick1680 quarterD4. 타이4개, 다른보표에음없음, 문서검증 성공. 첫 native와 MusicXML의 재생시작/길이/음높이 동일 확인.
- 화면:1280×720,1024×768,390×844,320×740. 메뉴 width672/696/274/204px, 모두 height180px, launcher와 하단일치 및12px 왼쪽간격 확인. 모바일 실제 row 가로스크롤로 옥타브 접근, 도움말 열기/닫기, 작은화면 닫기44px 확인. 저장알림 bottom640, 메뉴top652로 겹침해소. CUA 기존 탭 입력이 반영되지 않아 별도 IAB 검증탭에서 정상 진행했으며 앱오류로그는 없었다.
- 검증: QA `/var/folders/ns/8yh7k1zn3q9flcsx0msyzfhm0000gn/T/garak-ui-qa-1p26sdhd`에서 typecheck, lint, production build+전체 **181/181 통과**. 핵심 이동 회귀5개(연결화음·자기겹침·표현/박자표/마디확장·거부·왕복), 포인터/좌표20개, rendered6개 포함. 로그 `/tmp/garak-horizontal-full-test.log`, `/tmp/garak-horizontal-lint.log`, `/tmp/garak-horizontal-core.log`. 이후 모바일toast CSS만 변경하여 브라우저 좌표와 rendered 검사를 재확인.
- 화면 증거: `/Users/cksmacbook/.codex/visualizations/2026/10/13/01a13394-4572-7673-bedf-dd913162895d/garak-side-palette-tablet.jpg`, 같은 폴더 `garak-side-palette-mobile.jpg`.
- 마무리: 기존 사용자 수정본 `Drag note QA`를 실제 파일 선택으로 복원하고 브라우저 저장을 완료했다. 임시 viewport 해제, 최종 error/warn 로그 없음. 새 검증 탭은 복원된 원본과 열린 메뉴를 보여 주는 deliverable로 유지한다.
- 한계: 실물 iPad/Safari/Apple Pencil·손가락 터치/멀티터치 실기기 검증은 미실행. 화면 크기별 마우스 직접 조작과 touch/pen 공통 Pointer Events 판정 테스트를 구분한다. 운영 반영과 사용자 승인이 필요한 작업은 계속 보류.
- 변경: score/note-input/engraving-position, ScoreRenderer/NotationStudio, globals.css, 관련 테스트5개, 이 문서. 앞선 메뉴 높이349px/위쪽 배치와 수직4px 전용 판정은 이번 항목이 대체한다.

## 2026-10-13 오선 음표 드래그·가로 플로팅 메뉴 (완료)

- 요청: 오선에서 음표를 드래그해 개별 화음 구성음/붙임줄 연결음을 수정하고 입력·저장·재열기까지 직접 확인한다. 물음표는 원형 버튼 위로, 입력 메뉴는 가로 배치로 바꾼다. 기존 미커밋 변경 보존. 커밋·푸시·배포·권한/의존성 변경은 없다.
- 드래그: VexFlow가 실제로 그린 각 notehead의 bounding box와 원래 noteId로 투명 버튼을 만든다. 인접 음정으로 좌우로 어긋난 화음도 잡은 구성음을 찾는다. 빈 오선 입력은 기존 버튼으로 유지하며 touch-action:none은 음표 머리에만 적용한다. mouse/touch/pen 공통 Pointer Events 사용. 4 CSS px 미만 수직 흔들림은 선택으로 처리하고, 이동량을 오선 간격에 맞춰 반올림한다. grab 위치를 기준으로 이동하므로 누른 위치 때문에 음이 뛰지 않는다. 임시표와 가져온 옥타브 -1..9 범위를 보존한다.
- 연결/기록: release에서만 `ScoreNotePitchIntent`를 `editEventNotation`의 정확한 noteId에 전달한다. 붙임줄 체인은 함께 변경하고 다른 구성음·리듬·타이 ID를 보존한다. 같은 화음 음높이와 충돌하면 원본 보존 및 악보 위에 오류 하나를 표시한다. 드래그 한 번은 실행 취소 한 단계이며, 선택 noteId도 기록/복원하고 없는 noteId는 제거한다. Inspector의 구성음 선택과 오선의 구성음 선택을 동기화했다.
- 취소/안내: 이동 중 음높이와 연결음 동반 변경을 미리 보여준다. Escape·pointercancel·capture 상실·다중 포인터·스크롤·resize·blur 시 취소한다. 실제 브라우저에서 첫 pointerdown의 선택 안내가 악보를 약52px 아래로 밀던 문제를 발견해, 드래그 가능한 음의 선택을 release로 미뤘다. 드래그 중은 미리보기만 바뀌며 취소하면 새 선택도 만들지 않는다. 음표/빈 공간 동작을 악보와 도움말에 설명한다.
- 메뉴: 최대740px, 두 영역 가로 배치, 데스크톱/태블릿 실제 높이349px. 물음표44px는 원형80px 버튼 바로 위12px 간격. 실제 악보 영역 너비760px 이하에서는 음길이/음높이와 보조 도구를 가로 스크롤하며 안내를 표시한다. 좁은 화면에도44px 도구 유지. 도움말은 두 버튼 위에 겹쳐 열리고 메뉴/도움말 높이를 화면 내로 제한한다.
- 브라우저 입력/수정: 새 `Drag note QA`에 half C4/E4/G4 화음2개를 입력해 E4끼리 연결했다. 가운데 E4 드래그로 두 E4→A4, Undo 한 번으로 복원, G4로 겹치는 변경 거부, E4→F4 연결 변경, 인접한 독립 G4→A4만 변경을 확인했다. F♭4→E♭4 드래그는 플랫과 연결을 보존했다. 390×844에서 빈 오선에 B4 quarter를 한 번 입력하고 D5로 드래그, 연결 E♭4→D♭4 수정, 키보드 Undo/Redo를 직접 실행했다.
- 저장/재열기: 브라우저 저장/reload, 실제 native/MusicXML 다운로드 및 파일 선택 재열기. `/Users/cksmacbook/Downloads/Drag-note-QA.garak.json`: [C4,E♭4,A4]/[C4,E♭4,G4] half2개, 가운데 음 타이1개, 낮은 보표 빈 상태를 파일 assertion으로 확인. `Drag-note-QA.musicxml`도 재열기 UI에서 확인. 모바일 `Drag-note-QA.garak (1).json`: 두 가운데 음은D♭4, 다른 구성음 동일, 3마디 D5 quarter1개, 타이1개. 수정한 뒤 그 파일 재열기로 D♭4 복원을 확인했다.
- 화면:1280×720,1024×768,390×844,320×568 검증. 문서 가로 넘침없음.390px 메뉴 실제 가로스크롤로 보조 도구 접근 확인.320px 메뉴/도움말은296×332px로 화면내 표시 및 내부스크롤. 최종 error/warn 로그없음. 실제 iPad/Safari/Apple Pencil·VoiceOver·음질 청취는 미실행; 화면 크기별 마우스 조작과 터치/펜 공통 판정 테스트를 물리 터치 검증으로 표현하지 않는다.
- 자동검증: QA 복사본 `/var/folders/ns/8yh7k1zn3q9flcsx0msyzfhm0000gn/T/garak-ui-qa-1p26sdhd`에서 typecheck/lint 통과. 첫 드래그 레이아웃 수정 후 영향 파일 lint/typecheck 및 production build+전체 **173/173** 재통과. note-input14개에 흔들림·배율·임시표·범위·원위치복귀·취소를 검증한다. 기존 코어 장기12음 체인 테스트를 ‘두 번째 화음 구성음’ 편집으로 강화했고 Native/MusicXML 왕복·원자거부도 유지했다. `git diff --check`와 원본/QA 주요3파일 cmp 통과. 로그 `/tmp/garak-drag-tests.log`, `/tmp/garak-drag-typecheck.log`, `/tmp/garak-drag-lint.log`.
- 화면 증거: `/Users/cksmacbook/.codex/visualizations/2026/10/13/01a13394-4572-7673-bedf-dd913162895d/garak-note-drag-result.jpg`, 같은 폴더 `garak-note-drag-horizontal-menu.jpg`, `garak-note-drag-help.jpg`, `garak-note-drag-mobile-menu.jpg`. 임시 viewport를 해제하고 로컬 `http://localhost:3018/` 테스트 악보를 유지한다.
- 변경: `components/ScoreRenderer.tsx`, `components/NotationStudio.tsx`, `lib/music/note-input.ts`, `app/globals.css`, 관련 테스트3개, 이 문서. 기존 코어/미리보기/연구 문서 변경을 보존했다. 요청한 로컬 구현/검증은 완료했고 승인 필요한 운영 반영은 계속 보류한다.

## 2026-10-13 붙임줄 길이·점 편집과 플로팅 입력 메뉴 (완료)

- 요청: 연결을 유지한 음길이·점 수정, 저장·재열기 직접 검증, Add note/Next note length를 악보 우하단 원형 버튼으로 접는 플로팅 메뉴, 옆 물음표의 겹쳐 뜨는 키보드 도움말, iPad에서 오선 탭 입력. 기존 미커밋 변경을 보존했고 커밋·푸시·배포·권한/의존성 변경은 하지 않았다.
- 코어: `editEventNotation`은 연결된 이벤트의 길이가 달라지면 같은 staff/voice의 뒤 이벤트를 마디 사이로 이동한다. 마디 경계를 넘는 단음·화음은 정확한 길이로 나눠 모든 구성음을 붙임줄로 연결한다. 기존 음/이벤트/타이 ID와 다른 보표, 기존 여백, 첫 조각의 표현을 보존하며 필요하면 마디를 추가한다. 연결음 앞의 일반 이벤트 수정으로 연결 시간이 깨질 때도 재배치한다. 일반적인 비연결 음의 기존 마디 길이 제약은 유지한다. 지원 음가로 정확히 표현할 수 없는 경계 잔여 길이 및 안전 한계 초과는 원본을 보존하고 거부한다.
- 편집 안내: 길이/점은 선택 이벤트 하나의 길이를 바꾸고 뒤의 음을 이동함을 명시한다. 여러 조각으로 나뉘면 적용한 길이·조각 수와 ‘현재 필드는 첫 조각의 길이’임을 Inspector 안에서 알린다. 이전 항목의 연결음 길이 수정 거부 한계는 해결했다.
- 플로팅 메뉴: 기존 입력 도구를 모든 화면에서 공통으로 쓰는 접힘 메뉴로 옮겼다. 기본 80px 원형 버튼 안에 오선·현재 다음 입력 음높이·음가·점·임시표를 SVG로 표시한다(`NoteEntryPreview.tsx`). 물음표는 메뉴 위에 별도 도움말을 연다. Escape는 도움말→메뉴 순으로 닫고 초점을 되돌린다. 바깥 클릭, 닫기 버튼, 원형 버튼으로 접을 수 있다. 작은 화면에서 내부 스크롤/44px 음가 버튼을 유지하고 기존 중복 모바일 입력 도크를 제거했다.
- 오선 입력: 메뉴의 `Tap the staff · touch / Pencil`에서 모드 선택 후 빈 오선 줄·칸을 탭하면 해당 마디 NEXT에 입력하고 기존 음표 탭은 선택한다. Pointer Events로 mouse/touch/pen을 처리한다. 10px 초과 이동·650ms 초과 누름·다중 포인터·취소·스크롤은 입력을 취소하며, 브라우저 기본 스크롤/확대 제스처를 막지 않는다. 호환 click으로 두 번 입력되지 않는다. 필기 음표 모양 인식은 구현하지 않았다.
- 실제 브라우저: 새 `Floating rhythm QA` 생성→C4 half+half+quarter와 붙임줄→quarter/half/점/겹점/whole 수정→마디 분할·안내→Undo/Redo→브라우저 저장/reload→native 다운로드·파일 선택 재열기→MusicXML 다운로드·재열기. 첫 native는 10박/6조각/5타이 보존. 오선 클릭 B4가 정확히 한 번 추가되고 이어진 드래그는 추가하지 않았다. 모바일에서 첫 음을 dotted half로 변경해 저장/reload/파일 재열기 후 9박/8조각/7타이 보존을 UI와 다운로드 파일 assertion으로 확인했다.
- 검증 파일: `/Users/cksmacbook/Downloads/Floating-rhythm-QA.garak.json`, `Floating-rhythm-QA.musicxml`, 클릭 검증 `Floating-rhythm-QA.garak (1).json`, 모바일 왕복 `Floating-rhythm-QA.garak (2).json`. 모두 로컬 테스트 악보다. 1280×720, 1024×768, 320×568에서 메뉴/도움말 열기·닫기·화면 내부 배치 확인, 390×844 화면 기록. 최종 viewport는 기본 1280×720으로 복원. 최종 브라우저 error/warn 로그 없음.
- 자동 검증: 기존 QA 복사본 `/var/folders/ns/8yh7k1zn3q9flcsx0msyzfhm0000gn/T/garak-ui-qa-1p26sdhd`에서 최종 typecheck, lint, production build, 전체 **169/169** 통과. 코어의 화음/ID/다른 보표/정확한 길이/실패 원자성/native·MusicXML·재생 길이와 터치 탭 취소 조건을 회귀 검증했다. 첫 TS 오류는 결과 union에 선택적 durationReflow를 일관되게 명시해 해결했다. 로그 `/tmp/garak-floating-tests.log`, `/tmp/garak-floating-lint.log`. 마지막 whitespace 정리 후 `git diff --check` 통과. 기존 bundle size 경고는 남는다.
- 화면: `/Users/cksmacbook/.codex/visualizations/2026/10/13/01a13394-4572-7673-bedf-dd913162895d/garak-floating-entry-closed.jpg`, 같은 폴더 `garak-floating-entry-menu.jpg`, `garak-floating-entry-help.jpg`, `garak-floating-entry-mobile.jpg`. 로컬 `http://localhost:3018/` 미리보기 유지.
- 한계: 실제 iPad/Safari/Apple Pencil/VoiceOver 및 초보 사용자 관찰·음질 청취는 미실행. 브라우저 화면 크기 검증과 실제 마우스 입력, 터치/펜 판정 로직 단위 테스트를 구분한다. 자유 필기 인식·사용자 도움/승인이 필요한 운영 반영은 수행하지 않았다. 이번 요청의 로컬 구현/검증은 완료했으며 다음 사용자 요청 전 추가 확장은 하지 않는다.
- 변경: `lib/music/score.ts`, `lib/music/note-input.ts`, `components/NotationStudio.tsx`, `components/NoteEntryPreview.tsx`, `components/ScoreRenderer.tsx`, `app/globals.css`, 관련 테스트 3개, 이 문서. 원본 node_modules 읽기 지연 때문에 실행은 계속 QA 복사본을 사용한다.

## 2026-10-13 붙임줄 연결 유지 편집·입력·삭제 흐름 개선 (완료)

- 요청: 붙임줄 연결 관계를 유지하며 음높이를 편집하고, 입력·수정·삭제·저장·재열기 흐름을 직접 사용해 혼동을 개선한다. 기존 미커밋 변경 보존. 커밋·푸시·운영 배포·의존성/권한 변경은 하지 않았다.
- 직접 재현: 기존 pitch 편집은 붙임줄을 먼저 제거하라는 오류를 반환했다. 툴바 붙임줄은 선택 음과 관계없이 마지막 두 이벤트의 첫 음에만 적용됐으며 연결 상태/개별 해제 위치가 Inspector에 없었다.
- 코어: `getTiedNoteIds`는 선택음을 포함한 앞뒤 전체 연결 ID를 반환한다. `editEventNotation`의 pitch 변경은 해당 연결 전체에 음이름·임시표·옥타브를 전파한다. 다른 구성음, ID, 타이 관계/ID, 리듬, 표현 정보는 보존한다. 연결된 먼 화음에서 중복 written pitch가 생겨도 원자적으로 거부한다. 시간 인접성을 깨뜨리는 길이 수정은 계속 거부한다.
- 연결 API: `setNoteTie(..., noteId, direction: incoming|outgoing, enabled)`는 선택 음의 해당 방향 연결만 추가/삭제한다. 같은 staff/voice의 실제 시간상 인접한 matching pitch를 요구하며 쉼표·마디 여백을 건너뛰지 않는다. noop은 원본 참조, 실패는 원본 보존. 기존 `toggleTieLastTwo` 호환 유지.
- UI: 선택 음의 `Tie to previous note` / `Tie to next note`와 `Remove previous tie` / `Remove next tie`를 Inspector에서 명시적으로 제공한다. 연결 삭제는 양쪽 음/리듬을 남김을 안내한다. 음높이 입력 위에 함께 수정되는 연결음 수와 범위를 표시하고 화음의 다른 음은 유지됨을 알린다. 툴바에 Tie previous/Untie previous 텍스트를 표시하고 T도 선택 음의 이전 연결에 적용한다. 선택이 없을 때만 Tie last two로 동작하고 쉼표 선택 시 비활성화된다.
- 오류/초점: 붙임줄 실패는 버튼 바로 아래 role=alert 및 오류 상태로 표시한다. Inspector의 Cmd/Ctrl+Z·Shift+Z·S는 버튼/컨테이너에서도 작동하고, 연속 Undo로 편집 요소가 제거되면 Inspector 컨테이너로 초점을 복구한다. 텍스트 입력의 기본 Undo와 다른 모달의 단축키 차단은 유지한다.
- 브라우저 검증: C4 세 음 연결 → 가운데 음의 D♭4/옥타브5 변경이 세 음에 전파 → 이전 연결만 해제 후 E♭5 변경이 뒤 두 음에만 적용 → 앞 음 D♭5 보존 → 불일치 재연결 거부 → Undo/재연결/T 토글. 두 음을 추가해 2마디 5음 연결을 만들고 마지막 음에 E5 구성음을 추가했다. 중간 음 변경이 마지막 화음의 E5와 중복되면 원본 보존/오류 안내를 확인했다. 마지막 화음의 연결음 수정으로 5음 전체 F♯5, 다른 E5 유지 확인.
- 저장/재열기: 브라우저 저장+reload 복구, 실제 `/Users/cksmacbook/Downloads/Tie-journey-QA.garak.json` 다운로드, 연결을 해제한 뒤 실제 파일 선택창으로 재열기를 수행했다. 다운로드 파일 assertion: quarter 이벤트 5개, 앞뒤 연결 4개, 연결음 모두 F♯5, 마지막 화음의 E5 그대로. 재열기 UI에서 5 linked notes 복구 확인.
- 모바일: 390×844에서 연결 삭제/버튼 초점의 Cmd+Z/없는 다음음 오류 위치 확인. 320×568에서 툴바 연결 해제/Undo, 새 Tie keyboard QA에 C4 두 음+tie 입력, Undo 3회로 빈 악보, Inspector 초점 유지, Redo 3회로 음과 tie 복구. 첫 음에서 outgoing 추가/삭제와 Cmd+S도 통과. 모바일 File 메뉴로 원래 파일을 다시 열어 5음 연결 복구. 버튼 높이 44px, 문서 가로 넘침 없음. viewport 기본 1280×720 복원, 최종 error/warn 로그 없음.
- 자동 검증: 기존 QA 복사본 `/var/folders/ns/8yh7k1zn3q9flcsx0msyzfhm0000gn/T/garak-ui-qa-1p26sdhd` 사용. 코어 82/82(12음/3마디 체인, 화음 중복 원자거부, native/MusicXML 실제 왕복 및 재생길이, 방향별 추가/삭제와 실패 경계) 통과. 신규 테스트 TS7022는 MusicEvent 타입 명시로 해결. 최종 typecheck, lint, production build, 전체 **161/161** 통과. 로그 `/tmp/garak-tie-tests.log`, `/tmp/garak-tie-lint.log`. 원본에서 실수로 시작한 typecheck는 즉시 중단하고 QA에서 수행했다. HMR 중 구/신 CSS가 겹친 화면은 저장+reload 뒤 정상 스타일로 확인했다.
- 화면: `/Users/cksmacbook/.codex/visualizations/2026/10/13/01a13394-4572-7673-bedf-dd913162895d/garak-tie-desktop-editor.jpg`, 같은 폴더 `garak-tie-mobile-editor.jpg`. `http://localhost:3018/`의 로컬 테스트 악보 미리보기 유지.
- 한계: 실제 초보 사용자 관찰, 실물 모바일/VoiceOver, 소리 청취는 미실행. 서로 떨어진 음이나 다른 음높이를 연결하는 이음줄(slur)은 별도 기능이며 이번 범위에 포함하지 않았다. 이전 항목의 ‘타이 연결음의 음높이 수정 미지원’은 해결됐다. 사용자 도움/승인이 필요한 운영 반영은 계속 보류.
- 변경 파일: `lib/music/score.ts`, `tests/music-core.test.ts`, `components/NotationStudio.tsx`, `app/globals.css`, `tests/rendered-html.test.mjs`, 이 문서. 기존 나머지 미커밋 변경을 보존했다.

## 2026-10-13 화음 구성음 편집·입력·삭제 흐름 개선 (완료)

- 요청: 화음 안의 개별 음높이 수정과 화음 입력·수정·삭제·저장·재열기 흐름을 직접 검증하고 혼동을 개선한다. 기존 미커밋 변경을 보존하며 사용자 도움/승인이 필요한 작업은 보류했다. 커밋·푸시·운영 배포·의존성 변경은 없다.
- 직접 재현: C–E–G를 입력하면 개별 구성음 선택/음높이 필드가 없었다. Chord 모드의 Delete는 마지막에 추가한 음만 제거했고, 다음 별도 화음을 시작하려면 모드 전환이 필요했다. 모바일에서는 선택 요약과 입력 대상이 중복되어 악보 높이를 과도하게 차지했다.
- 코어: `EventNotationUpdate.noteId?`를 추가했다. 화음 음높이 변경은 정확한 noteId를 요구하고 단음은 기존 생략 호출을 유지한다. 다른 음/음 ID/표현/길이/시간/타이를 유지하며, 없는 ID·pitch 없는 noteId·중복 written pitch·타이 무결성 실패는 원본을 원자적으로 보존하고 오류를 반환한다. `removeChordToneFromEvent(..., eventId, noteId?)`는 지정한 음과 그 음에 연결된 타이만 제거하며 생략 시 마지막 음 삭제 호환을 유지한다. 하나만 남은 음은 이 함수로 삭제하지 않는다.
- UI: Inspector의 `Choose a tone to edit` 버튼에서 C4/E♭5/G4처럼 음이름과 순번으로 구성음을 고른다. 선택 음의 이름·임시표·옥타브를 수정하고 `Remove [pitch] from chord`로 해당 음만 삭제한다. 음높이가 바뀌어도 ID로 선택을 유지하며, 삭제 후 유효한 남은 음으로 전환하고 키보드 초점을 유지한다. Undo로 삭제를 복원하면 원래 구성음 선택도 다시 유효해진다. 길이와 점은 `Whole chord rhythm`으로 아래에 분리했다.
- 삭제 범위: Inspector의 `Clear whole chord to rest`는 입력 모드와 관계없이 전체 화음을 같은 길이의 쉼표로 바꾼다. 기존 toolbar/mobile dock 및 Delete 단축키의 Chord 모드 동작(마지막 추가 음부터 삭제)과 Shift+Delete(시간 슬롯 제거)는 유지하고 도움말에 구분했다. 선택 없는 Inspector의 삭제 접근성 이름도 실제 전체 이전 입력 삭제 범위와 맞췄다.
- 입력: `Next chord`는 다음 pitch를 NEXT 위치의 별도 이벤트로 시작하도록 준비하고, 성공 후 후속 pitch는 그 새 화음에 추가한다. 기존 화음에 음을 더할 때는 길이가 유지됨을 표시하고 상단 길이 도구는 다음 화음 길이임을 안내한다. `Finish`는 단음 입력으로 돌아간다. 화음 안내에 Edit tones/Next chord/Finish를 모으고 중복 선택 요약을 숨겼다. 320px에서 버튼 3개는 각각 높이 44px이며 가로 넘침이 없다.
- 브라우저 검증: 새 `Chord journey QA` 생성 → C4/E4/G4 화음 입력 → E4만 E♭4로 수정 → 기존 G4로 중복 수정 거부 → 가운데 음만 삭제/Undo → 전체 화음 쉼표 전환/Undo → Next chord로 D4/F4/A4 별도 화음 → Finish 후 B4 eighth 입력 → 브라우저 저장 → 실제 native 다운로드/재열기를 수행했다. 첫 파일은 quarter 화음 2개 + eighth 단음 1개로 확인했다.
- 모바일 검증: 390×844에서 첫 화음 가운데 E♭4만 E♭5로 바꾸고 두 음을 삭제해 G4 단음만 남기는 경계와 Undo 복원을 확인했다. 브라우저 저장/reload 후 E♭5 복구, native 다운로드/재열기 후 복구를 확인했다. 두 실제 다운로드 파일을 비교해 가운데 음의 옥타브 외에 이벤트/음 ID·다른 구성음·뒤 화음·단음이 그대로임을 assertion으로 확인했다. 320×568에서는 Next chord → E4/G4 입력 → 기본 Delete로 G4만 삭제 → Undo와 원래 초안 복원을 확인했다. 마지막 viewport는 기본 1280×720으로 복원했다. 기본 헤더/도구 모음 및 모바일 문서의 가로 넘침 없음, 최종 error/warn 로그 없음.
- 자동 검증: 현재 소스를 기존 QA 복사본 `/var/folders/ns/8yh7k1zn3q9flcsx0msyzfhm0000gn/T/garak-ui-qa-1p26sdhd`에 동기화했다. 최종 typecheck/lint 통과, production build 통과. core targeted **79/79**(신규 3개) 통과. 전체 실행 158개 중 157개가 먼저 통과했고, 삭제 UI를 기존 3개 동일 동작으로 가정한 rendered source assertion을 새 명시적 전체 삭제 계약에 맞게 수정한 뒤 해당 파일 **4/4 재통과**했다. 나머지 154개도 앞선 전체 실행에서 통과했으므로 최종 검증 대상은 모두 통과했다. 로깅: `/tmp/garak-chord-20261013-tests.log`, `/tmp/garak-chord-rendered-tests.log`, `/tmp/garak-chord-lint.log`. git diff --check 통과. 기존 chunk 500 kB / Node module.register 경고는 유지된다.
- 해결한 개발 문제: 새 JSX에서 `eventName(chordTarget.event)` / `pitchName(selectedPitch)`를 호출하면 React Compiler가 객체 별칭을 변경 가능하다고 추론해 preserve-manual-memoization 오류를 냈다. 두 표시 문자열을 useCallback 선언 전 파생 값으로 계산해 해결했다. 규칙 비활성화·타입 우회·데이터 복제는 하지 않았다. HMR의 선택/모드 초기화 뒤에는 저장된 테스트 초안을 사용했다.
- 화면 증거: `/Users/cksmacbook/.codex/visualizations/2026/10/13/01a13394-4572-7673-bedf-dd913162895d/garak-chord-desktop-editor.jpg`, 같은 폴더 `garak-chord-mobile-editor.jpg`, `garak-chord-mobile-input.jpg`. IAB 일반 screenshot이 viewport override 크기와 맞지 않아 DOM viewport 크기를 확인한 뒤 같은 전체 영역의 clip으로 캡처했다. `http://localhost:3018/` 미리보기와 테스트 악보를 남겼다.
- 한계: 실제 사용자 관찰·물리 모바일/VoiceOver·음질 청취는 미실행. 타이 연결음을 독립 변경하는 편집은 타이 무결성을 지키기 위해 거부한다. 기존 타이 제거 후 수정할 수 있으며 연쇄 연결음 일괄 음높이 변경은 이번 범위 밖이다. 운영 반영/계정 연동은 계속 보류.
- 이번 변경: `components/NotationStudio.tsx`, `app/globals.css`, `lib/music/score.ts`, `tests/music-core.test.ts`, `tests/rendered-html.test.mjs`, 이 문서. 이전 단음 편집 작업의 ‘화음 구성음 편집 미지원’ 한계는 이번 작업으로 해소됐다.

## 2026-10-13 첫 사용자 생성·입력·수정·저장 흐름 개선 (완료)

- 목표: 새 악보 만들기부터 음표 입력·수정·저장까지 로컬 브라우저에서 직접 수행하고 헷갈리는 조작과 배치를 수정한다. 사용자 도움·추가 허락이 필요한 작업은 보류하며 커밋·푸시·운영 배포는 하지 않는다. 이전 미커밋 변경을 보존했다.
- 직접 재현: 템플릿 선택 즉시 기존 초안이 교체되며 제목은 `New morning`으로 남았다. 선택한 음표가 있어도 상단 음길이는 다음 입력에만 적용됐다. `Save now`는 브라우저 저장인데 다시 편집할 파일 다운로드는 `Garak JSON` 이름 아래 있었다.
- New: 제목/선택적 작곡가 입력, 선택 상태가 있는 편성 카드, 명시적 Create score로 분리했다. 빈 제목 오류와 취소를 제공한다. 초안 교체 안내는 고정 생성 영역에도 표시하며 기존 악보 다운로드 및 대화상자 안의 다운로드 결과를 제공한다. 새 악보는 C4·4분음표·점 없음·자동 임시표·단음 입력으로 초기화하고 입력 방식 선호는 유지한다. Undo는 기존 제한된 세션 기록 정책을 유지한다.
- 수정: 악보 위 `Edit selection`과 Inspector의 `Edit this note/rest`로 편집 위치를 드러냈다. 선택한 단일 음표의 음이름·임시표·옥타브, 음표/쉼표/화음의 길이·점을 직접 바꿀 수 있다. 상단 도구는 `Next note length` / `Add note`로 새 입력임을 구분한다. 빈 악보에서는 가짜 선택 요약과 비활성 표현 필드 대신 첫 입력 안내를 표시한다.
- 코어: `editEventNotation`은 원본 score와 ID·셈여림·아티큘레이션·임시표 표시 모드를 보존한다. 길이를 바꾸면 같은 마디의 뒤 이벤트 시간만 이동한다. 마디 초과·잘못된 타깃/값·타이 무결성 실패를 원자적으로 거부하며 오류를 선택 필드 아래 표시한다. 단일 화음 구성음의 음높이 편집은 미지원임을 UI에 표시한다. 변경은 기존 Undo/redo·자동 저장 경로를 쓴다.
- 단축키: select에 초점이 있어도 Cmd/Ctrl+Z 및 저장이 작동한다. Inspector 대화상자에서는 음표 편집 select의 명시적 Undo/redo/save만 예외로 허용하며 다른 모달과 일반 음표 입력 단축키 차단은 유지한다.
- 저장: 데스크톱 `Save a copy`와 모바일 File 메뉴 첫 내보내기 항목을 `Download editable score`로 명확히 했다. 브라우저 저장은 `Save in this browser`로 구분하고 자동 저장 중/중단 상태에 맞는 안내를 표시한다. 기존 손상 초안 보존 정책과 `Saved locally` 성공 판정은 유지한다.
- 브라우저 검증: 데스크톱에서 제목/작곡가 입력 → C·D 입력 → D를 E♭ 8분음표로 변경 → 넘치는 온음표 변경 거부 → Undo/redo → G 8분음표 추가 → 브라우저 저장 → 실제 .garak.json 다운로드 → 재열기를 수행했다. 다운로드 JSON에 제목·작곡가와 C4 quarter / E♭4 eighth / G4 eighth 3개 이벤트가 보존됨을 확인했다. 악보를 직접 클릭하고 좌우 키로 선택하는 경로도 확인했다.
- 모바일 검증: 390×844에서 편집 패널 열기·점음표 변경·Cmd+Z·닫은 뒤 Edit selection 초점 복귀를 확인했다. 320×568에서 제목 지정 → 생성 → C4 입력 → C5 8분음표 수정 → File의 브라우저 저장 → reload 후 C5 eighth 복구를 확인했다. New에서 현재 악보 다운로드, 편성만 바꾼 뒤 취소 시 원본 유지, 빈 제목 오류를 확인했다. 320px New 양식과 390px 문서 가로 넘침 없음. 1440px 도구 모음 및 복원한 1280px 헤더의 가로 넘침/버튼 잘림 없음. 최종 브라우저 error/warn 로그 없음. 임시 viewport는 복원했다.
- 자동 검증: 기존 실행용 복사본 `/var/folders/ns/8yh7k1zn3q9flcsx0msyzfhm0000gn/T/garak-ui-qa-1p26sdhd`에 최종 소스를 동기화했다. 최종 `npm run typecheck`, `npm run lint`, `npm test`의 production build + **155/155 테스트 통과**. 신규 코어 테스트 4개 묶음은 불변성·다른 staff 보존·재생 시간·native/MusicXML·타이·실패 원자성을 다룬다. 모달 단축키 source assertion은 새 Inspector 예외에 맞춰 변경하고 기존 차단 계약을 유지했다. 로그: `/tmp/garak-first-use-20261013-tests.log`. 기존 500 kB chunk / Node module.register deprecation 경고는 남는다.
- 실행 중 원본 node_modules 경로에서 실수로 시작한 build는 읽기 지연 때문에 종료하고 복사본에서 실행했다. 의존성/전역 설정은 수정하지 않았다. HMR이 선택 상태를 초기화한 뒤 저장된 초안에서 재개했으며 이를 제품의 편집 실패로 기록하지 않는다.
- 화면 증거: `/Users/cksmacbook/.codex/visualizations/2026/10/13/01a13394-4572-7673-bedf-dd913162895d/garak-first-use-desktop.jpg`, 같은 폴더 `garak-new-score-flow.jpg`, `garak-new-score-mobile.jpg`, `garak-mobile-note-editor.jpg`. `http://localhost:3018/`에 복원한 테스트 악보 미리보기를 남겼다.
- 한계/보류: 실제 초보 사용자 관찰·실제 휴대폰/VoiceOver 검증·음질 청취는 하지 않았다. 파일 하나의 각 화음 구성음을 편집하는 UI는 이번 단일음 편집 범위에 포함하지 않았다. 사용자 도움/승인이 필요한 운영 배포·계정 연동은 수행하지 않았다.
- 변경 파일: `components/NotationStudio.tsx`, `components/ScoreRenderer.tsx`(접근성 선택 안내), `app/globals.css`, `lib/music/score.ts`, `tests/music-core.test.ts`, `tests/rendered-html.test.mjs`, 이 문서. 다음 작업은 새 요청의 범위를 정하고 현재 파일과 이 기록을 대조한다.

## 2026-10-13 연구 기반 UI·사용 흐름 개선 (완료)

- 목표: 논문과 지정 디자인 자료를 참고해 불편한 도구 배치·정보 과밀·모바일 조작 발견 문제를 개선하고 로컬에서 검증한다. 도움이나 추가 승인이 필요한 작업은 보류한다.
- 시작 상태: 2026-10-11 작업의 미커밋 수정 6개 파일이 있었다. 박자 오류 안내·템포 정규화·음악 코어 및 테스트 변경을 보존했다. 이번 작업은 커밋·푸시·운영 배포를 하지 않았다.
- 연구: Search 스킬/Exa로 4개 관점, 중복 포함 검색 결과 47건에서 독립 논문 4편의 일차 출처를 확인했다. 연구 결과·제품 적용 판단·한계 및 UI UX Pro Max/Freesources/SEED 참조는 [UX_RESEARCH.md](UX_RESEARCH.md)에 기록했다. 외부 패키지·스킬 설치나 디자인 자산 복사는 없다.
- 도구 배치: 한 줄 가로 스크롤을 입력 방식 안내 + 음길이/음높이/옥타브 + 보조 조작의 그룹으로 변경했다. 실제 DOM 순서와 시각적 순서를 맞췄고, 8px로 잘리던 안내를 줄바꿈 가능한 11–12px 설명으로 바꿨다. Input guide는 관련 도구 옆에서 열 수 있다.
- 작업 공간: Score/Part 전환과 확대를 악보 위로 옮겼다. 선택 staff의 event 수가 전체 score 통계처럼 보이던 중복 표시와 반복 단축키 안내를 정리했다. 표면·글자·경계·강조 색과 속성 필드 간격을 맞췄으며 비활성 M/S 장식은 숨긴다.
- Inspector: Event/Score/Part 범위를 일반 버튼 그룹과 `aria-pressed`로 선택한다. 숨겨진 필드는 초점 순환에서 제외하고, 제목 클릭은 Score를 연 뒤 제목 필드에 초점을 준다. 기존 필드·메타데이터·박자 오류 계약은 유지한다.
- 모바일: 가로 한 줄 설정을 높이가 제한된 세로 스크롤 패널로 바꿨다. 설명을 표시하고 음길이 버튼은 44px를 유지하며 320px에서는 줄바꿈한다. 패널이 차지하는 높이만큼 악보 영역과 상태 메시지 위치를 조정한다. 파일 메뉴에 Folder 아이콘과 File 이름을 표시하고 내보내기 구분을 추가했다.
- 실행 환경: 원본 node_modules 읽기 지연으로 원본에서 시작한 dev/tsc를 중단하고, 기존 실행용 복사본 `/var/folders/ns/8yh7k1zn3q9flcsx0msyzfhm0000gn/T/garak-ui-qa-1p26sdhd`에 현재 소스·설정·테스트를 동기화했다. 의존성 재설치나 원본 node_modules 변경은 하지 않았다. `http://localhost:3018/`의 로컬 dev 서버와 미리보기 탭을 남겼다.
- 자동 검증: 복사본에서 최종 `npm run typecheck`, `npm run lint`, `npm test` 통과. 마지막 CSS 줄바꿈 수정 후 프로덕션 build + 전체 **151/151 테스트 통과**. 원본 `git diff --check` 통과. 기존 500 kB 초과 chunk 경고와 Node module.register deprecation 경고는 남는다. 로그: `/tmp/garak-ui-20261013-final-tests.log`.
- 브라우저 검증: 375×812, 768×1024, 1024×768, 1440×900에서 문서 가로 넘침 및 표시 중인 헤더/도구/악보 조작의 가로 잘림 없음. 320×568과 390×844에서 열린 모바일 설정의 가로 넘침 없음, 음길이 버튼 44px 확인. 새 사중주 생성, 버튼 입력과 arrow-duration 입력, undo/redo, Score/Part, 확대, Inspector 전환, staccato, 제목 초점, Escape 복귀, 숨김 패널을 제외한 Tab 순환, 재생 시작/정지, 새로고침 복구를 확인했다.
- 개발 중 HMR에서 일시적인 fetch 오류가 있었고 새로고침 후 최종 확인 구간의 브라우저 error/warn 로그는 비어 있었다. 실제 휴대폰·VoiceOver·음질 청취·사용자 작업 시간/오류율 측정은 하지 않았다. 사용성 향상 수치를 주장하지 않는다.
- 화면 증거: `/Users/cksmacbook/.codex/visualizations/2026/10/13/01a13394-4572-7673-bedf-dd913162895d/garak-desktop-refined.jpg`, 같은 폴더 `garak-mobile-refined.jpg`. 임시 viewport 설정은 복원했다.
- 이번 변경 파일: `components/NotationStudio.tsx`, `app/globals.css`, `tests/rendered-html.test.mjs`, `docs/UX_RESEARCH.md`, 이 문서. 승인 없이 진행 가능한 이번 개선과 검증은 완료했다. 추가 제품 결정이나 운영 반영은 수행하지 않았다.

## 2026-10-11 컴퓨터 유즈 점검 (완료)

- 목표: 로컬 브라우저에서 주요 악보 작성 흐름과 반응형 화면을 직접 사용하고, 재현한 버그·사용성 문제를 수정한 뒤 UI와 관련 검증을 통과한다.
- 시작 상태: `codex` 브랜치 `09fb14c`, 작업 트리 깨끗함. 커밋·푸시·배포는 요청 범위가 아니다.
- 환경: 기존 의존성/Git 파일 읽기가 지연되어 소스와 lockfile을 `/var/folders/ns/8yh7k1zn3q9flcsx0msyzfhm0000gn/T/garak-ui-qa-1p26sdhd`로 복사하고 `npm ci --no-audit --no-fund` 완료. 기존 node_modules는 보존했다. 수정은 원본에 적용하고 실행용 복사본에 동기화한다.
- 브라우저: 컴퓨터 유즈로 `http://localhost:3016/`를 사용한다. 기본 3000 포트에서 발견한 기존 로컬 초안은 편집하지 않았다.
- 수정 1: 모바일 Inspector에서 6/8 → 2/4 변경을 거부할 때 오류가 배경 toast에만 나타나 패널 뒤에 가려졌다. `NotationStudio.tsx`에서 해당 악보·시작 마디의 오류를 박자 선택 바로 아래에 표시하고 `aria-invalid`/`aria-describedby`를 연결했다. 악보 또는 시작 마디가 달라지면 오래된 오류는 표시하지 않는다. `score.ts`의 overflow 메시지도 내부 tick 수 대신 문제 위치와 해결 방법을 안내한다.
- 수정 2: 현재 120 BPM에서 120.4를 입력하면 실제 tempo는 120인데 입력칸은 120.4로 남았다. blur 시 실제 적용값으로 입력칸을 동기화한다. 빈 입력은 현재 tempo를 보존하고 숫자는 정수 30–300으로 보정한다. UI 재확인: `120.4 → 120`, 빈 값 `→ 120`, `999/301 → 300`, `0/29 → 30`, 정상 `120 → 120`; 모두 브라우저 validity 통과.
- UI 확인: 기본 1280×720 및 390×844 화면에서 사중주 생성, G major/6/8, 숫자→문자·화살표→숫자·버튼·악보 클릭 입력, 선택 음표를 쉼표로 변경/undo, chord·mf·staccato, Piano 추가/낮은 보표, Score/Part, 재생 시작/정지/진행 표시, 빈 마디 추가/제거, tempo/title, 박자 거부/정상 변경, 새로고침 복구를 확인했다. JSON/MusicXML은 실제 파일 선택창으로 다시 열었고 import undo/redo도 통과했다. 최종 browser error/warn 로그는 비어 있었다. 실제 휴대폰·음질 청취·인쇄/PDF·운영 환경은 이번 점검 범위에 포함하지 않았다.
- 다운로드 파일 확인: `~/Downloads/Garak-QA-2026-10-11.{garak.json,musicxml,mid}`. 5 parts, 9 note events/10 tones, 120 BPM. Native validation 통과. XML 재가져오기 warning 0개, 화음·mf·staccato·박자 변경 보존. MIDI header/6개 track 길이 검증 통과.
- 검증: 임시 복사본에서 `npm run typecheck`, `npm run lint`, 프로덕션 build 통과. `npm test`의 첫 실행은 예전 tempo 식을 검사하는 source assertion 1건만 실패(150/151); 의도된 새 계약으로 assertion을 갱신하고 같은 전체 10개 test file을 재실행하여 **151/151 통과**. 변경된 test file ESLint 재확인 및 원본 `git diff --check` 통과. 빌드에는 기존 500 kB 초과 chunk 경고가 남는다.
- 환경/도구 참고: 기존 node_modules의 dev 실행은 파일 읽기에서 지연되어 중지했다. 이후 Git 작업 트리 조회는 정상화됐다. 컴퓨터 유즈 download 이벤트 대기는 timeout이었지만 실제 파일은 Downloads에 생성되어 내용까지 확인했다. file chooser import는 정상 동작했다.
- 화면 증거: `/Users/cksmacbook/.codex/visualizations/2026/10/11/01a12a09-6906-7bd1-bdee-526b5cc5e56a/garak-mobile-meter-error.jpg`, 같은 폴더의 `garak-desktop-verified.jpg`. 임시 viewport는 원래 크기로 복원했고 검증용 브라우저와 3016 dev server를 남겼다.
- 변경 파일: `components/NotationStudio.tsx`, `app/globals.css`, `lib/music/score.ts`, 관련 기존 테스트 2개 및 이 문서. 커밋·푸시·배포 없이 완료했으며, 확인한 범위에 미해결 중대 문제는 없다.

이 문서는 “더 필요한 것이 있으면 기억해두고 나중에 계속”이라는 요청을 위해 유지하는 살아 있는 handoff입니다.

## 현재 공개 결과

- `/`에서 Garak 알파 편집기가 실행됩니다.
- 첫 방문은 Chamber orchestra 예제 score를 보여주고, New에서는 Solo, String quartet, Chamber orchestra, Symphony orchestra를 선택할 수 있습니다.
- 고유 ID 140개의 orchestral, keyboard, voice preset을 검색해 part를 추가할 수 있습니다.
- Score와 Part 보기는 같은 `ScoreDocument`를 읽습니다. Part 보기는 아직 독립 linked-part layout이 아닙니다.
- VexFlow SVG가 모든 part·staff·measure를 렌더하고, grand staff brace와 family bracket을 표시합니다. Runtime은 `vexflow/bravura` dynamic entry를 사용해 Academico Regular/Bold와 Bravura만 선택하며, final build마다 emitted chunk와 font payload를 다시 확인해야 합니다.
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
- `staccato`, `tenuto`, `accent`, `marcato` 또는 None 중 하나를 선택 staff 마지막 note event에 attach·replace·clear합니다. Trailing rest는 건너뛰고 chord tone은 mark 하나를 공유합니다. VexFlow는 보표 위에 사보하며 playback/MIDI는 staccato 50% duration, tenuto 기본 gate, accent/marcato velocity +14/+24(127 clamp)를 공유합니다. MusicXML은 네 표식을 leading chord note의 `<articulations>`로 왕복합니다.
- system은 고정 마디 수가 아니라 내용과 viewport에 따른 동적 spacing으로 나뉘며 measure ID→absolute-index map을 재사용해 반복 `indexOf` O(n²) lookup을 제거했습니다. 전체 layout complexity를 선형이라고 일반화할 수는 없고 pagination/virtualization도 아닙니다.
- 빈 마디 추가, 음악이나 tie가 없는 마지막 빈 마디 제거, 입력 중 자동 마디 추가가 모든 staff 구조를 보존합니다.
- Undo/redo past/future는 각각 현재 쪽 snapshot을 유지하면서 최대 100개와 UTF-8 JSON serialized-size proxy 8 MiB 중 먼저 닿는 경계에서 trim합니다. 예산보다 큰 단일 snapshot도 최소 1개는 유지합니다.
- Multi-staff Web Audio playback은 note duration의 90%·최소 5 ms gate, 18 ms 또는 duration 35% 이하 attack을 사용합니다. 한 번에 600음까지 가장 이른 onset부터 고르고, 한 onset이 한도를 넘으면 part별 round-robin으로 공정하게 선택하며 truncation status를 표시합니다.
- 검증된 primary + last-known-good backup local autosave/recovery와 native/MusicXML/MIDI export가 연결돼 있습니다. Primary 손상에서 backup을 열거나 두 snapshot이 모두 손상되어 fresh score를 열면 damaged raw를 보존하려고 명시적 Save now/New까지 autosave가 멈춥니다. Corruption·quota/write 실패를 성공과 구분해 status로 알립니다.
- File chooser에서 uncompressed score-partwise `.musicxml`/`.xml`의 staff별 primary-voice subset을 import하고, part-list 순서와 `divisions`·`backup`·`forward` 시간축, 표현 가능한 gap rest, chord/tie, 32nd/64th·겹점, 8단계 dynamic direction의 next-event anchor와 4개 articulation subset을 보존합니다.
- Import는 malformed XML·내부 DTD subset/entity 선언을 거부하고 UI 10 MiB, core 67,108,864 UTF-16 code unit, 256 part, part당 32/전체 512 staff, 20,000 measure, 10,000 staff×measure cell, 100,000 source measure child element 상한을 적용합니다. Materialized event/note/tie 상한은 50,000/100,000/50,000이며, 누적 full-meter timeline은 materialization 전에 native 536,870,910 tick 상한을 검사합니다.
- Import warning은 중복 제거된 visible 200개, 각 500 UTF-16 code unit과 필요할 때 omission summary 1개로 제한합니다. `implicit="yes"`/pickup metadata를 explicit measure로 바꾸는 손실, non-final underfill의 full-meter 지연 tick, 정규화 뒤 noncontiguous tie skip, 미지원·겹침·마디 초과 요소를 score 위치와 함께 표시합니다.
- MusicXML source ID는 256 code unit으로 제한하고 compact internal descendant ID에 증폭하지 않습니다. Exporter는 opaque native part ID를 XML 이름 규칙에 맞는 unique ID로 바꾸고 모든 reference에서 같은 mapping을 사용합니다.
- MusicXML은 실제 key/time boundary, initial tempo, dynamic direction, 단일 event-level articulation, multi-staff attributes·staff·voice·backup·full-measure rest를 보존합니다. MIDI는 실제 time-signature boundary와 staff별 dynamic/articulation velocity 및 staccato duration을 포함하며, MIDI와 playback 모두 모든 staff의 schema-v1 voice를 사용합니다. MIDI는 VLQ `0x0FFFFFFF` 상한, 960→480 PPQ 반올림과 최소 1-tick note를 적용하고, 같은 port/channel/pitch overlap은 긴 interval로 합쳐 later reattack/velocity를 잃는 compromise가 있습니다.
- MIDI/MusicXML routing은 instrument family가 아니라 clef를 기준으로 합니다. Percussion clef만 GM channel 10을 쓰고 timpani·glockenspiel 같은 pitched percussion은 melodic route를 사용합니다. Port마다 melodic route 15개, 전체 pitched 240개와 독립 unpitched-percussion part 16개가 상한이며 초과 시 명시적으로 실패합니다. MusicXML [`<midi-device>` port](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/midi-device/)는 1–16, 같은 SMF `FF 21` port는 0–15입니다.
- New/Add/Help/Import-warning modal과 responsive Inspector/Instruments drawer는 dialog initial focus, sibling `inert`, Tab/Shift+Tab trap, Escape close, 이전 focus 복원을 적용합니다.
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

MusicXML/Chord acceptance도 실제 file chooser로 확인했습니다. `.musicxml`의 지원하지 않는 Voice 2 warning을 검토하는 동안 현재 악보와 autosave는 바뀌지 않았고, `Cancel import`는 원본을 유지했습니다. 다시 가져와 `Open editable copy`를 선택한 뒤에만 제목·작곡가·Violin·G major·1 measure·G+B 2-note chord가 편집 상태로 열렸습니다. 이어 Chord mode에서 D4를 추가해 event count가 1로 유지되고 Inspector가 `Chord · 3 notes`, playback 상태가 `Playing 3 notes at ♩ = 96`인 것을 확인했습니다. 이 브라우저 증거는 자동 테스트 개수에 합산하지 않습니다.

## 수동 smoke

1. String quartet을 새로 만들고 Violin I을 선택합니다.
2. Concert key를 G major, meter를 6/8로 바꿉니다.
3. `4 C D E F G A`로 eighth note 여섯 개를 입력해 3+3 beam을 확인합니다.
4. 빈 마디를 추가한 뒤 마지막 빈 마디만 제거되는지 확인합니다.
5. Piano를 추가하고 lower staff를 클릭한 뒤 `3 C D E R`을 입력합니다.
6. 같은 pitch 두 번 입력 후 `T`, 이어 `Cmd+Z`, `Cmd+Shift+Z`를 확인합니다.
7. Space playback과 Score/Part 전환을 확인합니다.
8. JSON, MusicXML, MIDI export 후 새로고침 복구를 확인합니다.
9. Primary-voice chord와 미지원 Voice 2가 함께 든 `.musicxml`을 import해 warning 1건을 확인합니다. 먼저 `Cancel import`로 현재 악보가 유지되는지 확인한 뒤 다시 가져와 `Open editable copy`를 선택하고 chord 사보를 확인합니다.
10. `6`, `7`, `.`을 사용해 32nd·64th와 점 없음→한 점→겹점 순환을 확인합니다.
11. Chord mode에서 imported chord에 D4를 추가하고 event count 1, Inspector 3 notes, 3-note playback을 확인합니다.
12. Chord mode에서 Backspace로 마지막 D4 tone만 제거한 뒤 event count·duration이 그대로이고 한 번의 undo로 3-note chord가 복원되는지 확인합니다.
13. 최소 3마디에서 둘째 마디부터 key/time을 바꿔 다음 기존 change 직전까지만 적용되는지 확인하고, 축소한 meter에 넘치는 다른 part/staff/voice가 있으면 score 전체가 바뀌지 않는지 확인합니다.
14. 선택 staff 마지막 note와 rest에서 dynamic을 attach→replace→None으로 바꾸고, SVG 표시·다음 마디 playback velocity·MusicXML direction·MIDI velocity를 확인합니다. Export한 파일을 다시 import해 staff별 note/rest dynamic이 보존되는지도 확인합니다.
15. 저장을 두 번 바꿔 primary와 backup을 만든 뒤 primary만 손상시켜 last-known-good 복구 status를 확인합니다. Quota/write 실패를 모의할 때는 기존 primary가 유지되고 성공 status가 나오지 않아야 합니다.
16. Backup recovery 직후 한 번 편집하고 기다려 damaged primary raw가 그대로인지 확인한 뒤 Save now 또는 New에서만 autosave가 다시 시작되는지 확인합니다.
17. Preset 밖의 유효한 imported meter가 Inspector에 `imported/custom`으로 보이고, 5/8·7/8 빈 마디가 중앙 정렬 full-measure rest로 그려지는지 확인합니다.
18. New/Add/Help/Import warning modal과 responsive Inspector/Instruments drawer마다 focus가 내부에 갇히고 배경이 inert이며 Escape 후 trigger로 돌아오는지 확인합니다.
19. 선택 staff에 note 뒤 trailing rest를 입력하고 articulation을 staccato→accent→None으로 바꿔 rest가 아니라 note를 대상으로 하는지, SVG mark·undo/redo·playback/MIDI gate/velocity·MusicXML export/re-import가 일치하는지 확인합니다. Multiple supported marks, below placement, downward strong-accent, rest mark, breath-mark fixture의 warning도 함께 확인합니다.

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

### 6. Expressions와 articulations — semantic subset 확장

- 현재 `ppp`–`fff`/None을 선택 staff 마지막 event에 attach·replace·clear하고 SVG·staff별 지속 playback/MIDI·MusicXML export 지원. Import는 같은 8단계 direction을 staff·선택 primary voice의 다음 event에 붙여 measure를 넘어 carry
- 현재 4개 articulation/None을 선택 staff 마지막 note event에 attach·replace·clear하고 VexFlow·playback/MIDI·MusicXML import/export 지원. Chord는 event mark 하나를 공유하고 trailing rest는 건너뜀
- 다음은 임의 event/time-position 선택, imported offset·placement 보존, hairpin/wedge, `sfz`·other dynamic과 composite 원형 의미, interpolation과 reflow-safe anchor
- 다음 articulation 범위는 여러 mark 조합, editable placement/direction, slur·breath·fermata·ornaments, expression/tempo text, rehearsal mark, collision과 총보/파트 의미 보존

### 7. Repeats

- repeat barline, play count, volta, D.C./D.S./Coda/Fine
- 결정론적 traversal과 cycle 진단, playback/MIDI/MusicXML 일치

### 8. Linked-part layout

- 총보/파트 음악 데이터 공유와 양방향 수정 반영
- page/system break, spacing, margin 등 part별 layout override 분리
- batch PDF/MusicXML과 총보 데이터 비오염

### 9. MusicXML import — 현재 subset 확장

- 현재 uncompressed score-partwise `.musicxml`/`.xml`의 staff별 primary-voice metadata/part/staff/key/time/note/rest/chord/tie, 32nd/64th·겹점, 8단계 dynamic direction next-event/measure-carry, 4개 단일 articulation, source cursor의 `divisions`/`backup`/`forward`, 정확한 gap rest와 위치 기반 warning 지원
- malformed XML·내부 DTD subset/entity 거부와 UI/core XML·part·staff·measure 상한 적용
- 다음은 `.mxl`, multiple voices, tuplets, dynamic/articulation subset 밖의 directions/notations(fermata·ornaments·slur 포함), repeats, layout intent
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
- Articulation 편집은 선택 staff의 마지막 note event와 event/chord당 하나만 대상으로 합니다. Placement/direction은 above/up으로 정규화하고, 서로 다른 여러 지원 mark는 warning과 함께 source 순서상 마지막 값을 사용합니다. 개별 chord tone에만 있던 mark가 전체 editable chord event로 확대되면 위치 기반 warning을 냅니다. 임의 event 선택·복수 mark·slur·breath·fermata·ornaments는 없습니다. `<fermata>`와 `<ornaments>`는 현재 articulation importer의 모델·warning·round-trip 대상이 아닙니다.
- playback은 oscillator fallback이고 실제 GM program별 sample을 사용하지 않습니다.
- Tie chain은 exact same-pitch/stream adjacency만 허용하고 playback/MIDI에서 하나의 지속음으로 합쳐집니다. 현재 articulation transform은 chain 첫 event만 사용하므로 중간·마지막 destination-only staccato는 SVG/XML에는 남지만 재생 gate에 영향을 주지 않습니다. Chain mark 집계/거부 정책과 pedal은 후속 범위입니다.
- Live playback은 oscillator fallback이며 600-note scheduling window 뒤를 재생하지 않습니다. MIDI는 480 PPQ quantization과 same-port/channel/pitch overlap merge로 later reattack을 버립니다. 멀티 포트 routing은 지원하지만 exact expressive reattack은 여전히 보존하지 않습니다.
- MusicXML import는 uncompressed score-partwise `.musicxml`/`.xml`의 staff별 primary voice, 8단계 dynamic direction과 4개 articulation subset으로 제한됩니다. `.mxl`, multiple voices, semantic tuplets, fermata·ornaments·slur 및 나머지 directions/expressions, repeats, layout round-trip, parser depth/node budget과 광범위한 외부 앱 compatibility corpus는 아직 없습니다.
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
8. `articulation-extended`: 복수 mark 보존 모델, placement/direction, slur·breath·fermata·ornament import loss report와 playback map
9. `visual-golden`: solo, grand staff, quartet, 32-staff orchestra의 고정 font/page 결과
10. `virtual-pages`: 100 pages에서 DOM 상한, offscreen caret와 playback follow

이미 단위 회귀가 있는 G-major accidental state, 8개 meter beam/full-measure duration, measure-range key/time boundary와 전체 stream overflow 거부, 32nd/64th·겹점, transposition, grand/3-staff 생성·선택 입력, 마디 추가·안전 제거, chord 추가·마지막 tone 제거와 tie cleanup, semantic dynamic의 SVG/playback/MIDI/MusicXML export와 8단계 direction import·multi-staff/barline round-trip, 4개 단일 articulation의 model/Inspector/VexFlow/playback/MIDI/MusicXML round-trip과 손실 warning, primary+backup storage recovery, source-time-aware uncompressed primary-voice MusicXML import, multi-staff MusicXML/playback/MIDI는 “다음 fixture”로 다시 적지 않습니다.

## 상용 배포 전 gate

현재 package는 `private: true`인 비공개/닫힌 알파입니다. 직접·핵심 build/runtime dependency의 설치 버전, 라이선스 근거, 미해결 항목은 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)를 단일 handoff 기준으로 사용합니다. 현재 package의 SPDX 표기만으로 공개·상용 배포 준비 완료를 선언하지 않습니다.

공개·상용 web/desktop/mobile release 전에는 다음을 모두 닫아야 합니다.

1. `vexflow/bravura` release build에 포함되는 Academico Regular/Bold와 Bravura **3개 font payload**의 실제 shipped byte를 확인하고, 완전한 OFL text·copyright notice를 배포물의 사용자가 접근 가능한 Licenses surface에 제공합니다. Gonville·Petaluma·Petaluma Script·Leland는 현재 미포함이며 향후 채택 시 감사를 다시 엽니다.
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
