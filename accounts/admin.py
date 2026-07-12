from django.contrib import admin
from django.contrib.auth import get_user_model
from django.contrib.auth.admin import UserAdmin

from accounts.models import Profile

UserModel = get_user_model()


@admin.register(UserModel)
class AppUserAdmin(UserAdmin):
    pass


admin.site.register(Profile)
