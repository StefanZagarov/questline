from django.urls import path

from questlines import views

urlpatterns = [
    path("create", views.CreateQuestlineView.as_view(), name="questline-create"),
    path("<int:pk>/edit", views.EditQuestlineView.as_view(), name="questline-edit"),
    path(
        "<int:pk>/update-questline-status",
        views.UpdateQuestlineStatusView.as_view(),
        name="questline-status",
    ),
    path("<int:pk>/map-edit", views.EditMapView.as_view(), name="map-edit"),
    path(
        "<int:pk>/map/add-quest", views.CreateQuestView.as_view(), name="quest-create"
    ),
    path("quest/<int:pk>/edit", views.EditQuestView.as_view(), name="quest-edit"),
    path("quest/<int:pk>/move", views.MoveQuestView.as_view(), name="quest-move"),
    path("quest/<int:pk>/delete", views.DeleteQuestView.as_view(), name="quest-delete"),
]
