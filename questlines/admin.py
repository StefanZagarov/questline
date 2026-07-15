from django.contrib import admin

from questlines.models import Quest, Questline

admin.site.register(Questline)
admin.site.register(Quest)
