from django.urls import path

from questlines import views

urlpatterns = [
    path("create", views.CreateQuestlineView.as_view(), name="questline-create"),
    path("<int:pk>/map", views.DetailQuestlineView.as_view(), name="questline-map"),
    path("<int:pk>/map/add", views.CreateQuestView.as_view(), name="quest-create"),
]
