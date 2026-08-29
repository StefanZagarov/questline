from django.urls import path

from progress import views

urlpatterns = [path("<int:pk>", views.AdventureView.as_view(), name="adventure")]
