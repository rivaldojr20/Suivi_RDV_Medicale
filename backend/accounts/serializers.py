from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

class LoginSerializer(TokenObtainPairSerializer):
    def validate(self, attrs):
        data = super().validate(attrs)          # {"refresh", "access"}
        u = self.user
        data["user"] = {
            "id": str(u.id),
            "full_name": u.full_name,
            "role": u.role,
            "profession": u.profession,
            "center_id": str(u.center_id) if u.center_id else None,
        }
        return data