from rest_framework import generics, permissions
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView

from .serializers import RegisterSerializer, UserSerializer


class RegisterView(generics.CreateAPIView):
    serializer_class = RegisterSerializer
    permission_classes = [permissions.AllowAny]
    authentication_classes: list = []
    throttle_scope = "auth"  # per IP: limits mass account creation


class LoginView(TokenObtainPairView):
    """simplejwt's login, plus a per-IP limit that slows down password guessing."""

    throttle_scope = "auth"


class MeView(APIView):
    def get(self, request: Request) -> Response:
        return Response(UserSerializer(request.user).data)
