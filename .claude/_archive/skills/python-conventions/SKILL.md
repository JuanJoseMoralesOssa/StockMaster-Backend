---
name: python-conventions
description: Convenciones de código Python para engine/ (motor de reglas), api/ (FastAPI) y bot/ (Telegram) — quality gates (ruff/mypy/pytest), manejo de errores, logging sin secretos, patrón de testing con fakes en memoria, settings con pydantic-settings. Usa esta skill SIEMPRE que escribas o revises código Python en este repo, incluyendo scripts/ y tests/.
---

# Convenciones Python — engine / api / bot

Esta skill documenta convenciones **ya activas y enforced en CI**, no aspiraciones — cada regla de aquí tiene un gate real (ruff, mypy, pytest) o un test dedicado que la protege. Las reglas de **código sostenible** (las 4 reglas, POLA, lenguaje de dominio, complejidad accidental) viven en `clean-code-maintainability` y aplican también aquí; esta skill aporta su aplicación Python concreta — las secciones TypeScript de aquella no aplican.

## Stack confirmado

Workspace `uv` con 3 miembros (`engine`, `bot`, `api`), todos con `src/` layout y build `hatchling`. Python 3.12. Pydantic v2 (`BaseModel` para dominio, `pydantic-settings` `BaseSettings` para config), SQLModel para tablas. Sin dataclasses. `engine` es paquete puro (sin Telegram/HTTP); `api` es una capa delgada de transporte sobre `engine`; `bot` importa `engine` directo, en el mismo proceso.

## Quality gates (CI, `.github/workflows/ci.yml`) — en este orden

```bash
uv sync --group dev
uv run ruff check .          # lint: E,W,F,I,B,UP,SIM — ver pyproject.toml
uv run ruff format --check . # formato — nunca pelees con esto a mano, corré `ruff format .`
uv run mypy                  # tipos — ver alcance abajo, no es --strict
uv run pytest -q
```

Corré los cuatro antes de dar por terminado un cambio Python. `ruff format` decide el ancho de línea (110) — por eso `E501` está en `ignore`; no lo interpretes como permiso para líneas largas porque sí, es solo que el formateador ya lo resuelve.

## Tipos: mypy pragmático, no estricto — a propósito

`[tool.mypy]` en el `pyproject.toml` raíz activa `check_untyped_defs`, `warn_redundant_casts`, `warn_unused_ignores`, `no_implicit_optional`, con `ignore_missing_imports = true` (yfinance/telegram/anthropic sin stubs). **No** es `--strict`: la decisión explícita (comentada en el propio `pyproject.toml`) es atrapar `Optional` mal manejado y campos renombrados — los bugs reales de este proyecto — sin exigir anotar cada función. No agregues `disallow_untyped_defs` ni conviertas esto en `--strict` sin discutirlo; sería una regla nueva, no una que ya exista.

Hay un override específico: `bot.*` desactiva `union-attr`/`arg-type` porque `python-telegram-bot` tipa `update.effective_message` como `Message | None`, pero en un handler de comando siempre hay mensaje — ese ruido no vale la pena en todo el bot. `engine/` sí se chequea completo, es donde importan los bugs de tipos. Si escribís un módulo nuevo en `bot/`, no asumas que necesitás guards contra `None` en `effective_message`/`effective_chat` dentro de handlers de comando — el override ya lo cubre; sí ponelos si el valor puede ser `None` por una razón real de tu lógica, no solo por el tipo declarado.

`from __future__ import annotations` al tope de todo archivo nuevo — es el patrón universal ya en el 100% del código existente.

## Tipos de dominio: `engine/models.py` es el canon

`Verdict`, `TradeSide`, `Position`, `LlmPurpose` y `normalize_ticker` viven en `engine/src/engine/models.py` (puro, sin I/O — importable desde cualquier capa sin ciclos). Reglas activas desde la tanda de código sostenible (2026-07-10):

- **Nada de `"buy"`/`"sell"` literales** en engine/bot: se compara contra `TradeSide`. En los bordes el primitivo es correcto (schema HTTP con `Literal["buy","sell"]`, columna str de DB).
- **Posiciones**: `open_positions` devuelve `dict[str, Position]`; acceso por atributo (`pos.avg_cost`), jamás por clave-string. `Position.is_open` encapsula el epsilon de posición cerrada — no reintroduzcas `> 1e-9` inline.
- **Tickers**: toda normalización pasa por `normalize_ticker` (strip + `$` inicial + upper); `parse_ticker` (analyze.py) = esa normalización + validación regex. No escribas `strip().upper()` ad-hoc — storage tenía su propio dialecto y así se desincronizó la primera vez.
- **Telemetría LLM**: `purpose` se pasa con `LlmPurpose`, no con el string suelto — un typo partiría la agregación de `/uso`.
- **Centinelas**: si un valor especial puede llegar al usuario (`DAYS_TO_EARNINGS_UNKNOWN = 999`), el `CriterionResult` lleva `note` explicativa y el formateo la muestra.
- **Las reglas de negocio viven UNA vez en engine** y las consumen bot/api/web: `oversell_warning` (avisa, no bloquea; en edición recibe `exclude_trade_id`), `weekly_summary`/`format_weekly_summary` en reporting, `_apply_trade_to_position` como único acumulador de costo promedio en repos. Si un handler del bot o un router del API empieza a calcular reglas (cortes de fecha, P&L, validaciones de dominio), la corrección es moverlas a engine, no duplicarlas.
- En el bot, el patrón "primer argumento es un ticker" pasa por `bot/tickers.py::resolve_ticker_arg` (única definición del mensaje de ticker inválido); las horas `HH:MM` de config se consumen vía `Settings.screener_time_et`/`question_time_local`, no re-parseando el string.

## Manejo de errores: degradar, nunca crashear

Regla central del proyecto (explícita en `decisiones.md` § "Convenciones técnicas"): **el bot nunca debe crashear por falta de un dato.** El patrón dominante en `engine`/`bot` es `try/except Exception` amplio en el borde de I/O (llamada a Finnhub/FMP/Anthropic/OpenAI, parseo de una respuesta externa), con `# noqa: BLE001` explícito cuando el catch ancho es intencional, degradando a un valor "no evaluado" o un mensaje al usuario — no propagando la excepción hacia arriba.

Solo hay **una** excepción custom en todo el repo: `BudgetExceeded(RuntimeError)` en `engine/src/engine/data/cache.py` — para el caso genuinamente excepcional (presupuesto de API agotado) donde SÍ tiene sentido cortar el flujo. No multipliques excepciones custom por capa; el proyecto deliberadamente no tiene esa jerarquía.

En `api/`, los errores de configuración (p. ej. no se puede construir el provider por falta de API key) se traducen a `HTTPException` 503 en `api/src/api/deps.py` (`provider_dep`). Hay otras dos conversiones deliberadas de error interno a HTTP: `BudgetExceeded` → 503 en el router que puede toparse con ella (`api/src/api/routers/charts.py`), y un fallo del provider al pedir velas → 502 vía `candles_fetch_error`, centralizada en `api/src/api/deps.py` (a diferencia de SPY o una cotización suelta, que sí degradan a `None`, el gráfico no se puede construir sin las velas del ticker principal). Esas son las tres conversiones intencionales; no agregues una cuarta ad-hoc en cada router.

```python
try:
    quote = finnhub_client.quote(ticker)
except Exception as e:  # noqa: BLE001 — cualquier fallo del proveedor externo degrada, no propaga
    logger.warning("No se pudo obtener cotización de %s: %s", ticker, e)
    return None  # el llamador debe tratar None como "sin dato", no como error
```

## Logging: nunca secretos en el archivo de log

`engine/src/engine/logging_setup.py` centraliza formato (`%(asctime)s %(levelname)s %(name)s: %(message)s`) + `RotatingFileHandler`, y silencia `httpx`/`httpcore`/`telegram` a `WARNING` porque esas libs loguean a `INFO` la URL completa de cada request — que incluye el token del bot de Telegram y las API keys de FMP/Finnhub en la query string. Esto no es una sugerencia: `tests/test_logging_secrets.py` lo verifica activamente inyectando un log falso con un secreto y afirmando que no aparece en el archivo. Si agregás una librería HTTP nueva que loguea a `INFO`, sumala a `_NOISY_HTTP_LOGGERS` en vez de bajar el nivel global — y si tocás `logging_setup.py`, corré ese test antes de dar el cambio por bueno.

`logging.getLogger(__name__)` estándar en cada módulo — no un logger global compartido.

## Settings: `pydantic-settings`, falla al arrancar, no en runtime

`engine/src/engine/settings.py` usa `BaseSettings` con `field_validator` para reglas de negocio (formato `HH:MM`, enums de provider) que deben fallar en el arranque del proceso, no silenciosamente en medio de una corrida. `@lru_cache` sobre el getter da un singleton por proceso — en tests, instanciá `Settings(...)` directo (no uses el getter cacheado) para no compartir estado entre tests.

## Testing: fakes en memoria, no mocks

El orden de trabajo es **TDD** (ver `clean-code-maintainability`, regla 1 de código sostenible): para lógica nueva con decisiones y para todo bugfix, el test se escribe antes del código — en un bug, primero el test en rojo que lo reproduce.

El repo **no usa** `unittest.mock`, `respx` ni VCR/cassettes. El patrón consistente es implementar la ABC/protocolo del dominio con un fake en memoria (ver `MarketDataProvider` fake en `tests/test_fallback.py`, `tests/test_api_endpoints.py`) e inyectarlo:
- En `api/`, vía `app.dependency_overrides` de FastAPI.
- En `engine`/`bot`, pasando el fake donde se espera la interfaz real (duck typing).

Fixture compartida `tmp_settings` en `tests/conftest.py` da una DB SQLite temporal por test. No hay `pytest.mark.parametrize` en el repo — el estilo establecido es un test por caso con nombre descriptivo, no una matriz parametrizada; seguí ese estilo salvo que el caso realmente lo pida (muchas variantes del mismo assert).

Antes de escribir un mock con `unittest.mock.patch`, preguntate si un fake en memoria de la interfaz es más simple — es lo que el resto del repo espera encontrar.

Los fakes/builders compartidos (proveedor bullish, velas, fundamentales, `FakeThesisProvider`, `make_settings`) viven en `tests/conftest.py` — no los redefinas por archivo. Y **los tests no asertan atributos privados** (`_providers`, `_budget`, ...): si necesitás observar estado interno, exponé una property read-only documentada como costura de testeo (precedente: `provider_names`, `transcribers`, `budget`, `extra_body`, `daily_budget`) y asertá sobre ella — un refactor interno no debe romper tests que no verifican comportamiento.

## Docstrings y comentarios: prosa libre, no Google/NumPy style

Casi todo módulo tiene docstring, pero ninguno sigue Google/NumPy (`Args:`/`Returns:`). Es prosa que explica el **por qué** o el comportamiento no obvio de un módulo (una decisión de dominio, un invariante, un workaround), no la firma. Ver `engine/src/engine/rules/engine.py` o `tests/test_logging_secrets.py` como ejemplo del tono esperado — una o dos frases que le ahorran al lector re-derivar el razonamiento.

## Idioma: código en inglés, dominio y "por qué" en español

Identificadores (nombres de función, variable, clase) 100% en inglés/snake_case — igual que `types.ts` del lado `web/`. Los mensajes de cara al usuario (Telegram, respuestas del API) van en español. Los docstrings y comentarios están **mezclados en la práctica**: inglés para el comportamiento técnico de un módulo (`cache.py`, `analyze.py`, `settings.py` tienen el docstring en inglés), español para el razonamiento de dominio/negocio (el método del seminario, los verdictos) y notas de operación (`logging_setup.py`, `test_logging_secrets.py` en español). Igualá el idioma del archivo que estás tocando en vez de forzar una traducción. No traduzcas identificadores existentes a español ni mezcles namings (`obtener_quote` ✗, `get_quote` ✓ con un comentario en español si hace falta explicar el porqué).

## Checklist antes de commitear un cambio Python

- [ ] `uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest -q` — los cuatro pasan
- [ ] Nuevo I/O externo (proveedor de datos, LLM) tiene manejo de error que degrada, no propaga — salvo que el caso sea genuinamente fatal (ver `BudgetExceeded` como único precedente de excepción custom)
- [ ] Si agregaste una librería HTTP nueva: revisaste si loguea secretos a `INFO` y la sumaste a `_NOISY_HTTP_LOGGERS` si hace falta
- [ ] Tests nuevos usan un fake en memoria de la interfaz, no `unittest.mock`, salvo que mockear sea genuinamente más simple
- [ ] Lógica nueva o bugfix: el test se escribió antes que el código (TDD) — en un bug, el test que lo reproduce estuvo en rojo primero
- [ ] `from __future__ import annotations` presente en archivos nuevos
- [ ] Sin excepciones custom nuevas a menos que el caso sea tan excepcional como `BudgetExceeded`
- [ ] Identificadores en inglés; comentarios de "por qué" y mensajes de usuario en español
- [ ] Conceptos de dominio con los tipos de `engine/models.py` (`TradeSide`, `Position`, `LlmPurpose`, `normalize_ticker`), no literales ni dicts de claves-string; reglas de negocio nuevas en engine, no en handlers/routers
