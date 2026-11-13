Original prompt: Отдельная серверная копия игры с кабинетами, админкой, допуском к экзаменам и нерешёнными заданиями.
Согласованный план находится в чате от 13.11.2026. Исходные game и Pages не изменять.
Этап: создание независимого проекта. Ещё не опубликован.

QA 13.11.2026: server store/API tests pass; Playwright isolated DB and ports 8085/5175: registration, approval, access, unresolved, answer, pause, history, mobile. Findings sent: logout retains admin page; HTML login pattern invalid in Chromium v-mode. Artifacts: output/testdata/.

13.11.2026: Создан repo seferov-star/solid-learning; DNS academy CNAME и academy-api A настроены в Cloudflare без изменений старых записей. Pages workflow 43407657221 success, сертификат LE academy-api выдан до 11.02.2027. API образ a1c6bfd скачан output/api-image.tar.gz (147976873 bytes); после текущих content/operations изменений нужен новый CI образ. Server 11 тестов проходят, Terra проверил UI и 20 клиентов/backup. Исходный проект не менялся. Следующее: финальные CI, загрузка OCI на VPS, compose, nginx HTTPS, bootstrap credentials в защищённый локальный файл, backup timer, живой QA, Landings.
