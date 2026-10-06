# bg-mcp-http

Servidor MCP remoto y **de solo lectura** para Banco General, expuesto por HTTPS
con el transporte oficial **Streamable HTTP**. Está pensado para desplegarse en
Vercel y para que el cliente MCP solo conozca un Bearer token; las credenciales
del banco permanecen como secretos privados del servidor.

## Seguridad y arquitectura

- `POST /mcp` exige `Authorization: Bearer <token>` y compara el token en tiempo
  constante.
- El MCP no publica tools de login ni recibe usuario, contraseña, respuesta de
  seguridad o rutas bancarias desde el agente.
- El servidor inicia sesión automáticamente con `BG_USERNAME`, `BG_PASSWORD` y
  el mapa `BG_SECURITY_ANSWERS_JSON`. Lee la pregunta que devuelve el banco y
  selecciona únicamente su respuesta correspondiente.
- El transporte MCP es stateless, compatible con funciones serverless. La
  sesión bancaria se conserva únicamente mientras la instancia esté caliente y
  se reconstruye automáticamente cuando Vercel crea otra instancia o el banco
  expira las cookies.
- Toda petición bancaria pasa por la allowlist y blocklist de
  [`src/http/guard.ts`](src/http/guard.ts). No existe ningún tool de
  transferencias, pagos o escritura y el cliente HTTP jamás adjunta el token
  CSRF que esas operaciones necesitan.
- Si Banco General pide OTP, el servidor devuelve `OTP_REQUIRED`. Un segundo
  factor interactivo no se guarda ni se transmite al agente.

## Variables de entorno

| Variable | Tipo | Uso |
|---|---|---|
| `MCP_BEARER_TOKEN` | Secret | Token fijo que debe enviar el cliente MCP |
| `BG_USERNAME` | Secret | Usuario de Zona Segura |
| `BG_PASSWORD` | Secret | Contraseña de Zona Segura |
| `BG_SECURITY_ANSWERS_JSON` | Secret | Objeto JSON que relaciona cada pregunta de seguridad con su respuesta |
| `BG_SECURITY_ANSWER` | Secret, obsoleta | Fallback para instalaciones antiguas con una sola respuesta |
| `BG_CHROMIUM_EXECUTABLE_PATH` | Opcional, local | Ruta a Chromium para desarrollo fuera de Vercel |

Nunca subas un `.env` real. Copia [`.env.example`](.env.example) a `.env.local`
solo para desarrollo; `.gitignore` excluye todos los archivos `.env*` salvo el
ejemplo.

Configura las preguntas tal como aparecen en Banco General. La comparación
tolera diferencias de mayúsculas, espacios y signos finales de interrogación:

```json
{
  "¿Cuál es el nombre de tu primera mascota?": "respuesta-uno",
  "¿En qué ciudad naciste?": "respuesta-dos"
}
```

Si el banco devuelve una pregunta que no está en el mapa, el login termina con
`SECURITY_ANSWER_NOT_CONFIGURED`; la pregunta y las respuestas no se envían al
agente ni se incluyen en el error.

## Desarrollo

Requiere Node.js 20 o superior.

```bash
npm install
npm run check
npx vercel dev
```

Rutas:

- `GET /health`: confirma únicamente qué variables están configuradas, sin
  devolver sus valores.
- `POST /mcp`: endpoint MCP autenticado.

## Despliegue en Vercel

1. Importa este repositorio como un proyecto de Vercel.
2. Agrega las cuatro variables requeridas como **Secret** en Production y
   Preview.
3. Despliega. La función usa Node.js y tiene `maxDuration: 300` para permitir el
   login inicial con Chromium.
4. Comprueba `https://<dominio>/health` y conecta el cliente a
   `https://<dominio>/mcp`.

Los secretos no se incluyen durante la build ni en el repositorio. Después de
cambiar uno, crea un deployment nuevo.

## Conectar un cliente MCP

En Codex, guarda el Bearer en una variable local y referencia esa variable desde
la configuración; el valor no se escribe en el archivo:

```toml
[mcp_servers.bg]
url = "https://TU-PROYECTO.vercel.app/mcp"
bearer_token_env_var = "BG_MCP_BEARER_TOKEN"
```

Luego define `BG_MCP_BEARER_TOKEN` en el entorno donde corre Codex con el mismo
valor de `MCP_BEARER_TOKEN` configurado en Vercel.

Para clientes que aceptan headers explícitos:

```json
{
  "mcpServers": {
    "bg": {
      "type": "http",
      "url": "https://TU-PROYECTO.vercel.app/mcp",
      "headers": {
        "Authorization": "Bearer ${BG_MCP_BEARER_TOKEN}"
      }
    }
  }
}
```

## Tools

El proyecto conserva las tools de consulta del servidor original:

- `bg_list_accounts`
- `bg_get_account`
- `bg_list_transactions`
- `bg_list_card_transactions`
- `bg_get_card_statement`
- `bg_get_card_categories`
- `bg_get_pension`
- `bg_search_transactions`
- `bg_spending_summary`

Empieza por `bg_list_accounts`; devuelve los `portalId` que requieren las demás.
