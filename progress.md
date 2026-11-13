Original prompt: Отдельная серверная копия игры с кабинетами, админкой, допуском к экзаменам и нерешёнными заданиями.
Согласованный план находится в чате от 13.11.2026. Исходные game и Pages не изменять.
Этап: создание независимого проекта. Ещё не опубликован.

QA 13.11.2026: server store/API tests pass; Playwright isolated DB and ports 8085/5175: registration, approval, access, unresolved, answer, pause, history, mobile. Findings sent: logout retains admin page; HTML login pattern invalid in Chromium v-mode. Artifacts: output/testdata/.
