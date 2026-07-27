from django.urls import path

from common import views

# from common import views

urlpatterns = [
    path("", views.HomePageView.as_view(), name="home"),
    path("explore", views.ExploreQuestlinesView.as_view(), name="explore"),
]
