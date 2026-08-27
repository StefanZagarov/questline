from django.urls import path

from progress import views

urlpatterns = [path("adventure/<int:pk>", views.AdventureView.as_view(), name="adventure")]
