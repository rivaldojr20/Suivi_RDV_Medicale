# syncapi/urls.py
from django.urls import path
from . import views

urlpatterns = [
    path("pull", views.pull),
    path("push", views.push),   # étape suivante
]