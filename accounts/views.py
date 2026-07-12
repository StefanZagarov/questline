from django.contrib.auth import get_user_model
from django.contrib.auth import views as auth_views
from django.shortcuts import render
from django.urls import reverse_lazy
from django.views import generic as views

from accounts.forms import AppUserCreationForm

UserModel = get_user_model()


class UserRegisterView(views.CreateView):
    model = UserModel
    # Redundant, automatically set, but displaying it here to show how assigning a form works
    form_class = AppUserCreationForm
    template_name = "accounts/register-page.html"
    success_url = reverse_lazy("login")


class UserLoginView(auth_views.LoginView):
    template_name = "accounts/login-page.html"


class UserLogoutView(auth_views.LogoutView):
    pass
