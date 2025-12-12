#!/bin/bash

# Script de despliegue para Azure Container Apps
# IMPORTANTE: Configura las variables de entorno antes de ejecutar

# Verificar que las variables de entorno estén configuradas
if [ -z "$BD_URL" ]; then
    if [ -z "$BD_HOST" ] || [ -z "$BD_USER" ] || [ -z "$BD_PASSWORD" ] || [ -z "$BD_DATABASE" ]; then
        echo "❌ Error: Debes configurar BD_URL o las variables BD_HOST, BD_USER, BD_PASSWORD y BD_DATABASE"
        echo "Ejemplos:"
        echo "  export BD_URL='postgresql://user:pass@host:5432/dbname'"
        echo "  # o"
        echo "  export BD_HOST='tu_host' BD_USER='tu_user' BD_PASSWORD='tu_pass' BD_DATABASE='tu_db'"
        exit 1
    fi
fi

# Configuración
RESOURCE_GROUP="${RESOURCE_GROUP:-rg-inventory-backend}"
LOCATION="${LOCATION:-eastus}"
ENVIRONMENT_NAME="${ENVIRONMENT_NAME:-env-inventory-backend}"
APP_NAME="${APP_NAME:-backend-inventory-app}"
REGISTRY_NAME="${REGISTRY_NAME:-acrinventorybackend}"
IMAGE_NAME="${IMAGE_NAME:-backend-inventory}"
TAG="${TAG:-latest}"

# Variables de base de datos (PostgreSQL)
BD_HOST="${BD_HOST:-localhost}"
BD_PORT="${BD_PORT:-5432}"
BD_USER="${BD_USER:-postgres}"
BD_DATABASE="${BD_DATABASE:-postgres}"

echo "🚀 Iniciando despliegue en Azure Container Apps..."
echo "📊 Configuración:"
echo "   Resource Group: $RESOURCE_GROUP"
echo "   Location: $LOCATION"
echo "   App Name: $APP_NAME"
echo "   Registry: $REGISTRY_NAME"

# 1. Login a Azure (si no está autenticado)
echo "📝 Verificando autenticación en Azure..."
az account show > /dev/null 2>&1
if [ $? -ne 0 ]; then
    echo "🔑 Necesitas autenticarte en Azure..."
    az login
fi

# 2. Crear Resource Group
echo "📦 Creando Resource Group..."
az group create \
    --name $RESOURCE_GROUP \
    --location $LOCATION

# 3. Crear Azure Container Registry
echo "🏗️ Creando Azure Container Registry..."
az acr create \
    --resource-group $RESOURCE_GROUP \
    --name $REGISTRY_NAME \
    --sku Basic

# 4. Habilitar admin en ACR
echo "🔧 Habilitando admin en ACR..."
az acr update \
    --name $REGISTRY_NAME \
    --admin-enabled true

# 5. Obtener credenciales de ACR
echo "🔑 Obteniendo credenciales de ACR..."
ACR_SERVER=$(az acr show --name $REGISTRY_NAME --query loginServer --output tsv)
ACR_USERNAME=$(az acr credential show --name $REGISTRY_NAME --query username --output tsv)
ACR_PASSWORD=$(az acr credential show --name $REGISTRY_NAME --query passwords[0].value --output tsv)

echo "🏗️ Registry Server: $ACR_SERVER"

# 6. Build y push de la imagen Docker
echo "🐳 Construyendo imagen Docker..."
docker build -t $IMAGE_NAME:$TAG .

echo "🏷️ Etiquetando imagen para ACR..."
docker tag $IMAGE_NAME:$TAG $ACR_SERVER/$IMAGE_NAME:$TAG

echo "🔑 Login a ACR..."
echo $ACR_PASSWORD | docker login $ACR_SERVER --username $ACR_USERNAME --password-stdin

echo "📤 Subiendo imagen a ACR..."
docker push $ACR_SERVER/$IMAGE_NAME:$TAG

# 7. Crear Container Apps Environment
echo "🌍 Creando Container Apps Environment..."
az containerapp env create \
    --name $ENVIRONMENT_NAME \
    --resource-group $RESOURCE_GROUP \
    --location $LOCATION

# 8. Crear Container App
echo "🚀 Creando Container App..."
az containerapp create \
    --name $APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --environment $ENVIRONMENT_NAME \
    --image $ACR_SERVER/$IMAGE_NAME:$TAG \
    --target-port 3000 \
    --ingress external \
    --registry-server $ACR_SERVER \
    --registry-username $ACR_USERNAME \
    --registry-password $ACR_PASSWORD \
    --cpu 1 \
    --memory 2Gi \
    --min-replicas 1 \
    --max-replicas 5 \
    --env-vars \
        NODE_ENV=production \
        HOST=0.0.0.0 \
        PORT=3000 \
        BD_URL=$BD_URL \
        BD_HOST=$BD_HOST \
        BD_PORT=$BD_PORT \
        BD_USER=$BD_USER \
        BD_PASSWORD=$BD_PASSWORD \
        BD_DATABASE=$BD_DATABASE

# 9. Obtener URL de la aplicación
echo "🎉 ¡Despliegue completado!"
APP_URL=$(az containerapp show --name $APP_NAME --resource-group $RESOURCE_GROUP --query properties.configuration.ingress.fqdn --output tsv)
echo "🌐 Tu aplicación está disponible en: https://$APP_URL"
echo "🏥 Health check: https://$APP_URL/ping"
echo "📚 API Explorer: https://$APP_URL/explorer"

echo "✅ Despliegue finalizado exitosamente"
