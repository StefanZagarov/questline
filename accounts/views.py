from django.contrib.auth import get_user_model, login
from django.contrib.auth import views as auth_views
from django.shortcuts import redirect
from django.urls import reverse
from django.utils.http import url_has_allowed_host_and_scheme
from django.views import generic as views

from accounts.forms import AppUserCreationForm

UserModel = get_user_model()


class UserRegisterView(views.CreateView):
    model = UserModel
    # Redundant, automatically set, but displaying it here to show how assigning a form works
    form_class = AppUserCreationForm
    template_name = "accounts/register-page.html"

    # Manual login after succesful register
    def form_valid(self, form):
        # The parent saves the user and construct the response
        response = super().form_valid(form)
        # Attatch the registered user to the current session
        login(self.request, self.object)
        return response

    # super().form_valid() calls get_success_url before returning
    def get_success_url(self):
        next_url = self.request.GET.get("next", "")

        # Protect from malicious redirections - since the next= is exposed in the url, it can be tampered with. We need to make sure the domain remains the same on redirect
        if url_has_allowed_host_and_scheme(
            next_url,
            allowed_hosts={self.request.get_host()},
            require_https=self.request.is_secure(),
        ):
            return next_url

        return reverse("home")

    # Redirect logged in user if they attempt to reach register page
    def dispatch(self, request, *args, **kwargs):
        if request.user.is_authenticated:
            return redirect("home")
        return super().dispatch(request, *args, **kwargs)


class UserLoginView(auth_views.LoginView):
    redirect_authenticated_user = True
    template_name = "accounts/login-page.html"


class UserLogoutView(auth_views.LogoutView):
    pass
