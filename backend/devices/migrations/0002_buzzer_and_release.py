from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("devices", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="deviceunit",
            name="buzzer_pin",
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="deviceunit",
            name="is_object_detected",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="deviceunit",
            name="buzzer_active",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="alertlog",
            name="released_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
