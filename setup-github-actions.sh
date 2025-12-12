#!/bin/bash

# Script de configuración inicial para GitHub Actions
echo "🚀 Configurando GitHub Actions para Azure Container Apps..."

# Colores para output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Función para imprimir con colores
print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "${YELLOW}ℹ️  $1${NC}"
}

# Verificar prerrequisitos
echo "🔍 Verificando prerrequisitos..."

# Verificar Azure CLI
if ! command -v az &> /dev/null; then
    print_error "Azure CLI no está instalado"
    echo "Instálalo desde: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli"
    exit 1
fi
print_status "Azure CLI encontrado"

# Verificar GitHub CLI (opcional)
if ! command -v gh &> /dev/null; then
    print_warning "GitHub CLI no está instalado (opcional)"
    echo "Puedes instalarlo para gestión automática de secrets: https://cli.github.com/"
else
    print_status "GitHub CLI encontrado"
fi

# Verificar login de Azure
echo "🔑 Verificando autenticación de Azure..."
if ! az account show &> /dev/null; then
    print_error "No estás autenticado en Azure"
    echo "Ejecuta: az login"
    exit 1
fi
print_status "Autenticado en Azure"

# Obtener información de la suscripción
SUBSCRIPTION_ID=$(az account show --query id --output tsv)
SUBSCRIPTION_NAME=$(az account show --query name --output tsv)
print_info "Suscripción: $SUBSCRIPTION_NAME ($SUBSCRIPTION_ID)"

# Crear Service Principal
echo "🔐 Creando Service Principal para GitHub Actions..."
SP_NAME="github-actions-inventory-backend-$(date +%s)"

# Crear el Service Principal
SP_OUTPUT=$(az ad sp create-for-rbac \
    --name "$SP_NAME" \
    --role contributor \
    --scopes "/subscriptions/$SUBSCRIPTION_ID" \
    --sdk-auth)

if [ $? -eq 0 ]; then
    print_status "Service Principal creado exitosamente"
    echo "📋 Guarda este JSON como secret AZURE_CREDENTIALS en GitHub:"
    echo "----------------------------------------"
    echo "$SP_OUTPUT"
    echo "----------------------------------------"
else
    print_error "Error al crear Service Principal"
    exit 1
fi

# Generar configuración de secrets
echo ""
echo "🔑 Configuración de GitHub Secrets requerida:"
echo "=============================================="
echo ""
echo "Ve a tu repositorio en GitHub → Settings → Secrets and variables → Actions"
echo "y agrega los siguientes secrets:"
echo ""
echo "1. AZURE_CREDENTIALS (REQUERIDO):"
echo "   $SP_OUTPUT"
echo ""
echo "2. BD_PASSWORD (REQUERIDO):"
echo "   Tu password real de PostgreSQL"
echo ""
echo "3. BD_HOST (REQUERIDO):"
echo "   Tu host de PostgreSQL"
echo ""
echo "4. BD_USER (REQUERIDO):"
echo "   Tu usuario de PostgreSQL"
echo ""
echo "5. BD_DATABASE (REQUERIDO):"
echo "   Tu base de datos PostgreSQL"
echo ""
echo "6. BD_PORT (OPCIONAL):"
echo "   5432"
echo ""

# Si GitHub CLI está disponible, ofrecer configuración automática
if command -v gh &> /dev/null; then
    echo ""
    read -p "¿Quieres configurar los secrets automáticamente con GitHub CLI? (y/n): " AUTO_CONFIG

    if [ "$AUTO_CONFIG" = "y" ] || [ "$AUTO_CONFIG" = "Y" ]; then
        echo "🤖 Configurando secrets automáticamente..."

        # Verificar que estamos en un repositorio git
        if ! git rev-parse --git-dir > /dev/null 2>&1; then
            print_error "No estás en un repositorio Git"
            exit 1
        fi

        # Configurar AZURE_CREDENTIALS
        echo "$SP_OUTPUT" | gh secret set AZURE_CREDENTIALS
        print_status "AZURE_CREDENTIALS configurado"

        # Solicitar password de PostgreSQL
        read -s -p "🔑 Ingresa el password de PostgreSQL: " BD_PASSWORD
        echo ""
        echo "$BD_PASSWORD" | gh secret set BD_PASSWORD
        print_status "BD_PASSWORD configurado"

        # Configurar secrets requeridos
        read -p "🌐 Ingresa el host de PostgreSQL (BD_HOST): " BD_HOST
        read -p "👤 Ingresa el usuario de PostgreSQL (BD_USER): " BD_USER
        read -p "🗄️  Ingresa el nombre de la base de datos (BD_DATABASE): " BD_DATABASE
        read -p "🔢 Ingresa el puerto (BD_PORT, default 5432): " BD_PORT
        BD_PORT=${BD_PORT:-5432}

        echo "$BD_HOST" | gh secret set BD_HOST
        echo "$BD_USER" | gh secret set BD_USER
        echo "$BD_DATABASE" | gh secret set BD_DATABASE
        echo "$BD_PORT" | gh secret set BD_PORT

        print_status "Todos los secrets configurados automáticamente"
    fi
fi

echo ""
echo "📚 Próximos pasos:"
echo "=================="
echo "1. Configura los secrets en GitHub (si no se hizo automáticamente)"
echo "2. Haz push de los workflows a tu repositorio:"
echo "   git add .github/"
echo "   git commit -m '🤖 Add GitHub Actions workflows'"
echo "   git push origin main"
echo ""
echo "3. El despliegue se ejecutará automáticamente al hacer push a main"
echo ""
echo "4. Opcional: Configura SonarCloud y Snyk para análisis adicional"
echo "   - SonarCloud: https://sonarcloud.io"
echo "   - Snyk: https://snyk.io"
echo ""
print_status "Configuración completada"
echo ""
echo "🔗 Enlaces útiles:"
echo "- Workflows: .github/workflows/"
echo "- Documentación: .github/README.md"
echo "- Guía de despliegue: DEPLOYMENT.md"
