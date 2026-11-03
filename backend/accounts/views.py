from django.shortcuts import render
from rest_framework.permissions import AllowAny
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.response import Response
from rest_framework_simplejwt.views import TokenObtainPairView
from .serializers import LoginSerializer 
# Create your views here.

class LoginView(TokenObtainPairView):
    serializer_class = LoginSerializer


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def health(request):
    return Response(status=204)