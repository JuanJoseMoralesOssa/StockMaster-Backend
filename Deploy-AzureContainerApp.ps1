# Script de despliegue para Azure Container Apps (PowerShell)
param(
    [Parameter(Mandatory=$false)]
    [string]$ResourceGroup = "rg-inventory-backend",

    [Parameter(Mandatory=$false)]
    [string]$Location = "southcentralus",

    [Parameter(Mandatory=$false)]
    [string]$EnvironmentName = "env-inventory-backend",

    [Parameter(Mandatory=$false)]
    [string]$AppName = "backend-inventory-app",

    [Parameter(Mandatory=$false)]
    [string]$RegistryName = "acrinventorybackend",

    [Parameter(Mandatory=$false)]
    [string]$ImageName = "backend-inventory",

    [Parameter(Mandatory=$false)]
    [string]$Tag = "latest"
)

# Verificar que las variables de entorno están configuradas
if (-not $env:BD_URL) {
    if (-not $env:BD_HOST -or -not $env:BD_USER -or -not $env:BD_PASSWORD -or -not $env:BD_DATABASE) {
        Write-Error "❌ Error: Debes configurar BD_URL o las variables BD_HOST, BD_USER, BD_PASSWORD y BD_DATABASE"
        Write-Host "Ejemplos:" -ForegroundColor Yellow
        Write-Host "  `$env:BD_URL='postgresql://user:pass@host:5432/dbname'" -ForegroundColor Yellow
        Write-Host "  # o" -ForegroundColor Yellow
        Write-Host "  `$env:BD_HOST='tu_host'; `$env:BD_USER='tu_user'; `$env:BD_PASSWORD='tu_pass'; `$env:BD_DATABASE='tu_db'" -ForegroundColor Yellow
        exit 1
    }
}

# Variables de base de datos (PostgreSQL)
$BD_HOST = if ($env:BD_HOST) { $env:BD_HOST } else { "localhost" }
$BD_PORT = if ($env:BD_PORT) { $env:BD_PORT } else { "5432" }
$BD_USER = if ($env:BD_USER) { $env:BD_USER } else { "postgres" }
$BD_DATABASE = if ($env:BD_DATABASE) { $env:BD_DATABASE } else { "postgres" }

Write-Host "🚀 Iniciando despliegue en Azure Container Apps..." -ForegroundColor Green
Write-Host "📊 Configuración:" -ForegroundColor Cyan
Write-Host "   Resource Group: $ResourceGroup" -ForegroundColor White
Write-Host "   Location: $Location" -ForegroundColor White
Write-Host "   App Name: $AppName" -ForegroundColor White
Write-Host "   Registry: $RegistryName" -ForegroundColor White

# 1. Verificar Azure CLI
try {
    $azVersion = az --version
    Write-Host "✅ Azure CLI encontrado" -ForegroundColor Green
} catch {
    Write-Error "❌ Azure CLI no está instalado. Instálalo desde: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli"
    exit 1
}

# 2. Login a Azure (si no está autenticado)
Write-Host "📝 Verificando autenticación en Azure..." -ForegroundColor Yellow
$accountInfo = az account show 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "🔑 Necesitas autenticarte en Azure..." -ForegroundColor Yellow
    az login
}

# 3. Crear Resource Group
Write-Host "📦 Creando Resource Group..." -ForegroundColor Yellow
az group create --name $ResourceGroup --location $Location

# 4. Crear Azure Container Registry
Write-Host "🏗️ Creando Azure Container Registry..." -ForegroundColor Yellow
az acr create --resource-group $ResourceGroup --name $RegistryName --sku Basic

# 5. Habilitar admin en ACR
Write-Host "🔧 Habilitando admin en ACR..." -ForegroundColor Yellow
az acr update --name $RegistryName --admin-enabled true

# 6. Obtener credenciales de ACR
Write-Host "🔑 Obteniendo credenciales de ACR..." -ForegroundColor Yellow
$ACR_SERVER = az acr show --name $RegistryName --query loginServer --output tsv
$ACR_USERNAME = az acr credential show --name $RegistryName --query username --output tsv
$ACR_PASSWORD = az acr credential show --name $RegistryName --query passwords[0].value --output tsv

Write-Host "🏗️ Registry Server: $ACR_SERVER" -ForegroundColor Cyan

# 7. Build y push de la imagen Docker
Write-Host "🐳 Construyendo imagen Docker..." -ForegroundColor Yellow
docker build -t "$ImageName`:$Tag" .

Write-Host "🏷️ Etiquetando imagen para ACR..." -ForegroundColor Yellow
docker tag "$ImageName`:$Tag" "$ACR_SERVER/$ImageName`:$Tag"

Write-Host "🔑 Login a ACR..." -ForegroundColor Yellow
echo $ACR_PASSWORD | docker login $ACR_SERVER --username $ACR_USERNAME --password-stdin

Write-Host "📤 Subiendo imagen a ACR..." -ForegroundColor Yellow
docker push "$ACR_SERVER/$ImageName`:$Tag"

# 8. Crear Container Apps Environment
Write-Host "🌍 Creando Container Apps Environment..." -ForegroundColor Yellow
az containerapp env create --name $EnvironmentName --resource-group $ResourceGroup --location $Location

# 9. Crear Container App
Write-Host "🚀 Creando Container App..." -ForegroundColor Yellow
az containerapp create `
    --name $AppName `
    --resource-group $ResourceGroup `
    --environment $EnvironmentName `
    --image "$ACR_SERVER/$ImageName`:$Tag" `
    --target-port 3000 `
    --ingress external `
    --registry-server $ACR_SERVER `
    --registry-username $ACR_USERNAME `
    --registry-password $ACR_PASSWORD `
    --cpu 1 `
    --memory 2Gi `
    --min-replicas 1 `
    --max-replicas 5 `
    --env-vars NODE_ENV=production HOST=0.0.0.0 PORT=3000 BD_URL=$env:BD_URL BD_HOST=$BD_HOST BD_PORT=$BD_PORT BD_USER=$BD_USER BD_PASSWORD=$env:BD_PASSWORD BD_DATABASE=$BD_DATABASE

# 10. Obtener URL de la aplicación
Write-Host "🎉 ¡Despliegue completado!" -ForegroundColor Green
$APP_URL = az containerapp show --name $AppName --resource-group $ResourceGroup --query properties.configuration.ingress.fqdn --output tsv
Write-Host "🌐 Tu aplicación está disponible en: https://$APP_URL" -ForegroundColor Cyan
Write-Host "🏥 Health check: https://$APP_URL/ping" -ForegroundColor Cyan
Write-Host "📚 API Explorer: https://$APP_URL/explorer" -ForegroundColor Cyan

Write-Host "✅ Despliegue finalizado exitosamente" -ForegroundColor Green
