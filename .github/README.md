# 🤖 GitHub Actions CI/CD

Este proyecto utiliza GitHub Actions para automatizar el despliegue y testing del backend de inventario en Azure Container Apps.

## 📋 Workflows Configurados

### 1. 🚀 Deploy (`deploy.yml`)

**Trigger:** Push a `main` o `master`

**Funciones:**

- ✅ Ejecuta tests y linting
- 🐳 Construye imagen Docker
- 📤 Sube imagen a Azure Container Registry
- 🚀 Despliega en Azure Container Apps
- 🏥 Ejecuta health checks
- 📊 Genera resumen de despliegue

### 2. 🧪 CI (`ci.yml`)

**Trigger:** Push a branches de desarrollo, PRs

**Funciones:**

- 🧪 Tests en múltiples versiones de Node.js (18, 20, 22)
- 🔍 Linting con ESLint
- 🔨 Build del proyecto
- 🐳 Test de construcción Docker
- 🔒 Análisis de seguridad con Snyk
- 📊 Análisis de calidad con SonarCloud

### 3. 🏷️ Release (`release.yml`)

**Trigger:** Push de tags `v*.*.*`

**Funciones:**

- 🎉 Crea release en GitHub
- 📝 Genera changelog automático
- 🚀 Despliega versión específica a producción
- 🏥 Validación post-despliegue

### 4. 🤖 Dependabot (`dependabot.yml`)

**Trigger:** PRs de Dependabot

**Funciones:**

- ✅ Auto-aprueba PRs de dependencias
- 🔄 Auto-merge si tests pasan
- 📦 Actualiza npm, GitHub Actions y Docker

## 🔑 Secretos Requeridos

Configura estos secretos en GitHub → Settings → Secrets and variables → Actions:

### Obligatorios

```
AZURE_CREDENTIALS='{
  "clientId": "xxx",
  "clientSecret": "xxx",
  "subscriptionId": "xxx",
  "tenantId": "xxx"
}'
MYSQL_PASSWORD=tu_password_mysql
```

### Opcionales

```
MYSQL_HOST=mysql-jm-inv-bd.mysql.database.azure.com
MYSQL_USER=bbjbzdifjkMaestraioAdmin
MYSQL_DATABASE=jm_inv_db
SNYK_TOKEN=tu_token_snyk
SONAR_TOKEN=tu_token_sonarcloud
```

## 🛠️ Configuración Inicial

### 1. Crear Service Principal de Azure

```bash
# Login a Azure
az login

# Obtener subscription ID
az account show --query id --output tsv

# Crear Service Principal
az ad sp create-for-rbac \
  --name "github-actions-inventory-backend" \
  --role contributor \
  --scopes /subscriptions/YOUR_SUBSCRIPTION_ID \
  --sdk-auth
```

### 2. Configurar SonarCloud (Opcional)

1. Ve a [SonarCloud](https://sonarcloud.io)
2. Conecta tu repositorio de GitHub
3. Obtén el token del proyecto
4. Actualiza `sonar-project.properties` con tu organización

### 3. Configurar Snyk (Opcional)

1. Ve a [Snyk](https://snyk.io)
2. Conecta tu cuenta de GitHub
3. Obtén tu token de API
4. Agrégalo como secret `SNYK_TOKEN`

## 🚀 Uso

### Despliegue Automático

```bash
git push origin main  # Despliega automáticamente
```

### Release

```bash
# Crear y pushear tag
git tag v1.0.0
git push origin v1.0.0  # Crea release y despliega
```

### Ejecución Manual

```bash
# Ve a Actions → Deploy to Azure Container Apps → Run workflow
```

## 📊 Monitoring

### Logs del Workflow

- Ve a Actions en tu repositorio
- Selecciona el workflow específico
- Revisa logs detallados de cada paso

### Logs de la Aplicación

```bash
az containerapp logs show \
  --name backend-inventory-app \
  --resource-group rg-inventory-backend \
  --follow
```

### Health Checks

Los workflows automáticamente verifican:

- ✅ `/ping` endpoint
- 🏥 Estado del container
- 📊 Métricas de despliegue

## 🔧 Personalización

### Cambiar Configuración de Azure

Edita las variables `env` en los workflows:

```yaml
env:
  RESOURCE_GROUP: tu-resource-group
  LOCATION: tu-region
  APP_NAME: tu-app-name
```

### Modificar Tests

Los workflows ejecutan:

```bash
npm test      # Tests unitarios
npm run lint  # Linting
npm run build # Build del proyecto
```

### Cambiar Triggers

Modifica los triggers en cada workflow:

```yaml
on:
  push:
    branches: [main, develop] # Agregar más branches
```

## ⚡ Tips y Mejores Prácticas

### 1. Branch Protection

Configura branch protection en `main`:

- Require PR reviews
- Require status checks (CI)
- Require branches to be up to date

### 2. Environments

Usa GitHub Environments para:

- Staging vs Production
- Approval requirements
- Environment-specific secrets

### 3. Matrix Strategy

El CI usa matrix para probar múltiples versiones de Node.js:

```yaml
strategy:
  matrix:
    node-version: [20, 22]
```

### 4. Cache

Los workflows usan cache para acelerar builds:

```yaml
- uses: actions/setup-node@v4
  with:
    cache: 'npm'
```

## 🚨 Troubleshooting

### Error: Azure Login Failed

- Verifica `AZURE_CREDENTIALS` secret
- Asegúrate que el Service Principal tenga permisos

### Error: Docker Build Failed

- Revisa el Dockerfile
- Verifica dependencias en package.json

### Error: Health Check Failed

- Verifica que el endpoint `/ping` existe
- Revisa logs de la aplicación en Azure

### Error: Tests Failed

- Ejecuta tests localmente: `npm test`
- Revisa configuración de base de datos para tests

## 🔗 Enlaces Útiles

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Azure Container Apps Documentation](https://docs.microsoft.com/en-us/azure/container-apps/)
- [Azure CLI Reference](https://docs.microsoft.com/en-us/cli/azure/)
- [Docker Documentation](https://docs.docker.com/)
