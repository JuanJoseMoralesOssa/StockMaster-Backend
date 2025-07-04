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
if (-not $env:MYSQL_PASSWORD) {
    Write-Error "❌ Error: La variable de entorno MYSQL_PASSWORD no está configurada"
    Write-Host "Ejecuta: `$env:MYSQL_PASSWORD='tu_password_aqui'" -ForegroundColor Yellow
    exit 1
}

# Variables de base de datos
$MYSQL_HOST = if ($env:MYSQL_HOST) { $env:MYSQL_HOST } else { "mysql-jm-inv-bd.mysql.database.azure.com" }
$MYSQL_USER = if ($env:MYSQL_USER) { $env:MYSQL_USER } else { "bbjbzdifjkMaestraioAdmin" }
$MYSQL_DATABASE = if ($env:MYSQL_DATABASE) { $env:MYSQL_DATABASE } else { "jm_inv_db" }

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
    --env-vars NODE_ENV=production HOST=0.0.0.0 PORT=3000 MYSQL_HOST=$MYSQL_HOST MYSQL_USER=$MYSQL_USER MYSQL_PASSWORD=$env:MYSQL_PASSWORD MYSQL_DATABASE=$MYSQL_DATABASE

# 10. Obtener URL de la aplicación
Write-Host "🎉 ¡Despliegue completado!" -ForegroundColor Green
$APP_URL = az containerapp show --name $AppName --resource-group $ResourceGroup --query properties.configuration.ingress.fqdn --output tsv
Write-Host "🌐 Tu aplicación está disponible en: https://$APP_URL" -ForegroundColor Cyan
Write-Host "🏥 Health check: https://$APP_URL/ping" -ForegroundColor Cyan
Write-Host "📚 API Explorer: https://$APP_URL/explorer" -ForegroundColor Cyan

Write-Host "✅ Despliegue finalizado exitosamente" -ForegroundColor Green
