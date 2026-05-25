# 📋 Guía de Despliegue en Azure Container Apps

Esta guía te ayudará a desplegar tu backend de inventario en Azure Container Apps paso a paso.

## 📝 Prerrequisitos

1. **Azure CLI** instalado
2. **Docker** instalado y ejecutándose
3. **Cuenta de Azure** con permisos para crear recursos
4. **Suscripción de Azure** activa
5. **Repositorio de GitHub** (para despliegue automático)

## 🚀 Opciones de Despliegue

### 🤖 Opción A: Despliegue Automático con GitHub Actions (Recomendado)

#### 1. Configurar GitHub Secrets

Ve a tu repositorio en GitHub → Settings → Secrets and variables → Actions y agrega:

**Secretos requeridos:**

- `AZURE_CREDENTIALS`: Credenciales de Azure (Service Principal)
- `BD_PASSWORD`: Password de tu base de datos PostgreSQL
- `BD_HOST`: Host de PostgreSQL
- `BD_USER`: Usuario de PostgreSQL
- `BD_DATABASE`: Base de datos PostgreSQL
- `BD_PORT`: Puerto de PostgreSQL (opcional, default: 5432)

**Secretos opcionales:**

- `SNYK_TOKEN`: Token de Snyk para análisis de seguridad
- `SONAR_TOKEN`: Token de SonarCloud para análisis de código

#### 2. Crear Service Principal de Azure

```bash
# Login a Azure
az login

# Crear Service Principal
az ad sp create-for-rbac --name "github-actions-inventory" \
  --role contributor \
  --scopes /subscriptions/YOUR_SUBSCRIPTION_ID \
  --sdk-auth
```

Copia el JSON resultante y guárdalo como secret `AZURE_CREDENTIALS`.

#### 3. Configurar workflows

Los workflows ya están configurados en `.github/workflows/`:

- `deploy.yml`: Despliegue automático al hacer push a main/master
- `ci.yml`: Tests y validaciones en PRs
- `release.yml`: Despliegue de releases con tags
- `dependabot.yml`: Auto-merge de dependencias

#### 4. Hacer push y desplegar

```bash
git add .
git commit -m "🚀 Setup GitHub Actions deployment"
git push origin main
```

¡El despliegue se ejecutará automáticamente!

### 🔧 Opción B: Despliegue Manual

## 🚀 Pasos de Despliegue

### 1. Preparar el entorno

```bash
# Instalar Azure CLI (si no está instalado)
winget install Microsoft.AzureCLI

# Verificar instalación
az --version

# Login a Azure
az login
```

### 2. Configurar variables de entorno

```bash
# Windows PowerShell
$env:BD_PASSWORD="TU_PASSWORD_REAL_AQUI"
$env:BD_HOST="TU_HOST_POSTGRES"
$env:BD_USER="TU_USUARIO_POSTGRES"
$env:BD_DATABASE="TU_BASE_DE_DATOS_POSTGRES"
$env:BD_PORT="5432"

# O crear archivo .env.deployment
cp .env.deployment.example .env.deployment
# Editar .env.deployment con tus valores reales
```

### 3. Ejecutar el despliegue

#### Opción A: PowerShell (Recomendado para Windows)

```powershell
.\Deploy-AzureContainerApp.ps1
```

#### Opción B: Bash

```bash
chmod +x deploy-secure.sh
./deploy-secure.sh
```

### 4. Verificar el despliegue

Una vez completado el despliegue, tendrás:

- **URL de la aplicación**: `https://tu-app.azurecontainerapps.io`
- **Health Check**: `https://tu-app.azurecontainerapps.io/ping`
- **API Explorer**: `https://tu-app.azurecontainerapps.io/explorer`

## 🔧 Configuración Avanzada

### Escalado automático

Tu aplicación está configurada para escalar automáticamente entre 1-5 réplicas basándose en:

- CPU utilization
- Número de peticiones concurrentes (30 por réplica)

### Recursos asignados

- **CPU**: 1 core
- **Memoria**: 2GB
- **Puerto**: 3000

### Variables de entorno configuradas

- `NODE_ENV=production`
- `HOST=0.0.0.0`
- `PORT=3000`
- `MYSQL_HOST`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`

## 🛠️ Comandos útiles post-despliegue

### Ver logs de la aplicación

```bash
az containerapp logs show \
  --name backend-inventory-app \
  --resource-group rg-inventory-backend \
  --follow
```

### Actualizar la aplicación

```bash
# Build nueva imagen
docker build -t backend-inventory:v2 .

# Tag para ACR
docker tag backend-inventory:v2 acrinventorybackend.azurecr.io/backend-inventory:v2

# Push a ACR
docker push acrinventorybackend.azurecr.io/backend-inventory:v2

# Actualizar Container App
az containerapp update \
  --name backend-inventory-app \
  --resource-group rg-inventory-backend \
  --image acrinventorybackend.azurecr.io/backend-inventory:v2
```

### Escalar manualmente

```bash
az containerapp update \
  --name backend-inventory-app \
  --resource-group rg-inventory-backend \
  --min-replicas 2 \
  --max-replicas 10
```

### Ver métricas

```bash
az containerapp show \
  --name backend-inventory-app \
  --resource-group rg-inventory-backend \
  --query properties.template.scale
```

## 🔒 Seguridad

- La aplicación usa HTTPS automáticamente
- Las credenciales de base de datos se almacenan como secretos
- La imagen Docker ejecuta con usuario no-root
- Health checks configurados para disponibilidad

## 💰 Costos estimados

Container Apps cobra por:

- **vCPU por segundo**: ~$0.000024/segundo
- **Memoria por segundo**: ~$0.0000025/GB/segundo
- **Peticiones**: Primeros 2M gratis/mes

**Estimación mensual** (1 réplica corriendo 24/7):

- vCPU: ~$62/mes
- Memoria: ~$13/mes
- **Total**: ~$75/mes

## 🆘 Troubleshooting

### Error: "Resource group not found"

```bash
az group create --name rg-inventory-backend --location eastus
```

### Error: "Registry name not available"

```bash
# Cambiar el nombre del registry en el script
$RegistryName = "acrinventorybackend$(Get-Random)"
```

### Error: "Image pull failed"

```bash
# Verificar que la imagen existe en ACR
az acr repository list --name acrinventorybackend
```

### Error de conexión a PostgreSQL

- Verificar que el servidor PostgreSQL permite conexiones desde Azure Container Apps
- Verificar las credenciales de base de datos
- Revisar las reglas de firewall / networking del servidor PostgreSQL

## 📞 Soporte

Si encuentras problemas:

1. Revisa los logs con `az containerapp logs show`
2. Verifica que todos los prerrequisitos están instalados
3. Asegúrate de que las variables de entorno están configuradas
4. Consulta la [documentación oficial de Azure Container Apps](https://docs.microsoft.com/en-us/azure/container-apps/)
