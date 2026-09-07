from django.urls import path

from progress import views

urlpatterns = [
    path("<int:pk>", views.AdventureView.as_view(), name="adventure"),
    path(
        "<int:pk>/start-adventure",
        views.StartAdventureView.as_view(),
        name="start-adventure",
    ),
    path(
        "<int:enrollment_pk>/<int:objective_pk>/update",
        views.UpdateObjectiveProgressView.as_view(),
        name="update-objective-progress",
    ),
]
