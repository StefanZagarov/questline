from django.contrib.auth import get_user_model
from django.contrib.auth.backends import ModelBackend
from django.db.models import Q


class MyBackend(ModelBackend):
    def authenticate(self, request, username=None, password=None, **kwargs):
        User = get_user_model()
        # Find username or email that matches for the login field. Get first to return None instead of crashing if nothing is found
        found_user = User.objects.filter(
            Q(username=username) | Q(email=username)
        ).first()

        # user_can_authenticate - from ModelBackend - checks the account's is_active flag, returning False for deactivated accounts
        if (
            found_user
            and found_user.check_password(password)
            and self.user_can_authenticate(found_user)
        ):
            return found_user
        else:
            return None
