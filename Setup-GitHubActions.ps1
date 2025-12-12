# Script de configuración inicial para GitHub Actions (PowerShell)
param(
    [Parameter(Mandatory=$false)]
    [switch]$AutoConfig = $false
)

Write-Host "🚀 Configurando GitHub Actions para Azure Container Apps..." -ForegroundColor Green

# Función para imprimir con colores
function Write-Status {
    param([string]$Message)
    Write-Host "✅ $Message" -ForegroundColor Green
}

function Write-Warning {
    param([string]$Message)
    Write-Host "⚠️  $Message" -ForegroundColor Yellow
}

function Write-Error {
    param([string]$Message)
    Write-Host "❌ $Message" -ForegroundColor Red
}

function Write-Info {
    param([string]$Message)
    Write-Host "ℹ️  $Message" -ForegroundColor Cyan
}

# Verificar prerrequisitos
Write-Host "🔍 Verificando prerrequisitos..." -ForegroundColor Yellow

# Verificar Azure CLI
try {
    $azVersion = az --version 2>$null
    if ($LASTEXITCODE -ne 0) { throw }
    Write-Status "Azure CLI encontrado"
} catch {
    Write-Error "Azure CLI no está instalado"
    Write-Host "Instálalo con: winget install Microsoft.AzureCLI"
    exit 1
}

# Verificar GitHub CLI (opcional)
try {
    $ghVersion = gh --version 2>$null
    if ($LASTEXITCODE -ne 0) { throw }
    Write-Status "GitHub CLI encontrado"
    $HasGitHubCLI = $true
} catch {
    Write-Warning "GitHub CLI no está instalado (opcional)"
    Write-Host "Puedes instalarlo para gestión automática de secrets: winget install GitHub.cli"
    $HasGitHubCLI = $false
}

# Verificar login de Azure
Write-Host "🔑 Verificando autenticación de Azure..." -ForegroundColor Yellow
try {
    $accountInfo = az account show 2>$null | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { throw }
    Write-Status "Autenticado en Azure"
} catch {
    Write-Error "No estás autenticado en Azure"
    Write-Host "Ejecuta: az login"
    exit 1
}

# Obtener información de la suscripción
$subscriptionId = $accountInfo.id
$subscriptionName = $accountInfo.name
Write-Info "Suscripción: $subscriptionName ($subscriptionId)"

# Crear Service Principal
Write-Host "🔐 Creando Service Principal para GitHub Actions..." -ForegroundColor Yellow
$spName = "github-actions-inventory-backend-$(Get-Date -Format 'yyyyMMddHHmmss')"

try {
    $spOutput = az ad sp create-for-rbac `
        --name $spName `
        --role contributor `
        --scopes "/subscriptions/$subscriptionId" `
        --sdk-auth | ConvertFrom-Json

    Write-Status "Service Principal creado exitosamente"

    # Convertir a JSON string para mostrar
    $spJson = $spOutput | ConvertTo-Json -Depth 10

    Write-Host "📋 Guarda este JSON como secret AZURE_CREDENTIALS en GitHub:" -ForegroundColor Cyan
    Write-Host "----------------------------------------" -ForegroundColor Gray
    Write-Host $spJson -ForegroundColor White
    Write-Host "----------------------------------------" -ForegroundColor Gray
} catch {
    Write-Error "Error al crear Service Principal: $($_.Exception.Message)"
    exit 1
}

# Generar configuración de secrets
Write-Host ""
Write-Host "🔑 Configuración de GitHub Secrets requerida:" -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Gray
Write-Host ""
Write-Host "Ve a tu repositorio en GitHub → Settings → Secrets and variables → Actions"
Write-Host "y agrega los siguientes secrets:"
Write-Host ""
Write-Host "1. AZURE_CREDENTIALS (REQUERIDO):" -ForegroundColor Yellow
Write-Host "   $spJson"
Write-Host ""
Write-Host "2. BD_PASSWORD (REQUERIDO):" -ForegroundColor Yellow
Write-Host "   Tu password real de PostgreSQL"
Write-Host ""
Write-Host "3. BD_HOST (REQUERIDO):" -ForegroundColor Yellow
Write-Host "   Tu host de PostgreSQL"
Write-Host ""
Write-Host "4. BD_USER (REQUERIDO):" -ForegroundColor Yellow
Write-Host "   Tu usuario de PostgreSQL"
Write-Host ""
Write-Host "5. BD_DATABASE (REQUERIDO):" -ForegroundColor Yellow
Write-Host "   Tu base de datos PostgreSQL"
Write-Host ""
Write-Host "6. BD_PORT (OPCIONAL):" -ForegroundColor Yellow
Write-Host "   5432"
Write-Host ""

# Si GitHub CLI está disponible, ofrecer configuración automática
if ($HasGitHubCLI -and ($AutoConfig -or (Read-Host "¿Quieres configurar los secrets automáticamente con GitHub CLI? (y/n)") -eq "y")) {
    Write-Host "🤖 Configurando secrets automáticamente..." -ForegroundColor Yellow

    # Verificar que estamos en un repositorio git
    try {
        git rev-parse --git-dir 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) { throw }
    } catch {
        Write-Error "No estás en un repositorio Git"
        exit 1
    }

    try {
        # Configurar AZURE_CREDENTIALS
        $spJson | gh secret set AZURE_CREDENTIALS
        Write-Status "AZURE_CREDENTIALS configurado"

        # Solicitar password de PostgreSQL
        $bdPassword = Read-Host "🔑 Ingresa el password de PostgreSQL" -AsSecureString
        $bdPasswordPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($bdPassword))
        $bdPasswordPlain | gh secret set BD_PASSWORD
        Write-Status "BD_PASSWORD configurado"

        # Solicitar secrets requeridos
        $bdHost = Read-Host "🌐 Ingresa el host de PostgreSQL (BD_HOST)"
        $bdUser = Read-Host "👤 Ingresa el usuario de PostgreSQL (BD_USER)"
        $bdDatabase = Read-Host "🗄️  Ingresa el nombre de la base de datos (BD_DATABASE)"
        $bdPort = Read-Host "🔢 Ingresa el puerto (BD_PORT, default 5432)"
        if (-not $bdPort) { $bdPort = "5432" }

        $bdHost | gh secret set BD_HOST
        $bdUser | gh secret set BD_USER
        $bdDatabase | gh secret set BD_DATABASE
        $bdPort | gh secret set BD_PORT

        Write-Status "Todos los secrets configurados automáticamente"
    } catch {
        Write-Error "Error configurando secrets: $($_.Exception.Message)"
    }
}

Write-Host ""
Write-Host "📚 Próximos pasos:" -ForegroundColor Cyan
Write-Host "==================" -ForegroundColor Gray
Write-Host "1. Configura los secrets en GitHub (si no se hizo automáticamente)"
Write-Host "2. Haz push de los workflows a tu repositorio:"
Write-Host "   git add .github/"
Write-Host "   git commit -m '🤖 Add GitHub Actions workflows'"
Write-Host "   git push origin main"
Write-Host ""
Write-Host "3. El despliegue se ejecutará automáticamente al hacer push a main"
Write-Host ""
Write-Host "4. Opcional: Configura SonarCloud y Snyk para análisis adicional"
Write-Host "   - SonarCloud: https://sonarcloud.io"
Write-Host "   - Snyk: https://snyk.io"
Write-Host ""
Write-Status "Configuración completada"
Write-Host ""
Write-Host "🔗 Enlaces útiles:" -ForegroundColor Cyan
Write-Host "- Workflows: .github/workflows/"
Write-Host "- Documentación: .github/README.md"
Write-Host "- Guía de despliegue: DEPLOYMENT.md"
